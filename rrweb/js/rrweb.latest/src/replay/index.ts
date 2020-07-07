import { rebuild, buildNodeWithSN } from 'rrweb-snapshot';
import * as mittProxy from 'mitt';
import * as smoothscroll from 'smoothscroll-polyfill';
import { Timer } from './timer';
import { createPlayerService } from './machine';
import {
  EventType,
  IncrementalSource,
  fullSnapshotEvent,
  eventWithTime,
  MouseInteractions,
  playerConfig,
  playerMetaData,
  viewportResizeDimention,
  missingNodeMap,
  addedNodeMutation,
  missingNode,
  incrementalSnapshotEvent,
  incrementalData,
  ReplayerEvents,
  Handler,
  Emitter,
  MediaInteractions,
  metaEvent,
} from '../types';
import { mirror, polyfill } from '../utils';
import getInjectStyleRules from './styles/inject-style';
import './styles/style.css';

const SKIP_TIME_THRESHOLD = 10 * 1000;
const SKIP_TIME_INTERVAL = 5 * 1000;

// https://github.com/rollup/rollup/issues/1267#issuecomment-296395734
// tslint:disable-next-line
const mitt = (mittProxy as any).default || mittProxy;

const REPLAY_CONSOLE_PREFIX = '[replayer]';

const defaultConfig: playerConfig = {
  speed: 1,
  root: document.body,
  loadTimeout: 0,
  skipInactive: false,
  showWarning: true,
  showDebug: false,
  blockClass: 'rr-block',
  liveMode: false,
  insertStyleRules: [],
  triggerFocus: true,
  modifiable: false,
};

export class Replayer {
  public wrapper: HTMLDivElement;
  public iframe: HTMLIFrameElement;

  public get timer() {
    return this.service.state.context.timer;
  }

  private config: playerConfig;

  private mouse: HTMLDivElement;

  private emitter: Emitter = mitt();

  private nextUserInteractionEvent: eventWithTime | null;
  private noramlSpeed: number = -1;

  // tslint:disable-next-line: variable-name
  private legacy_missingNodeRetryMap: missingNodeMap = {};

  private service!: ReturnType<typeof createPlayerService>;

  constructor(
    events: Array<eventWithTime | string>,
    config?: Partial<playerConfig>,
  ) {
    if (!config?.liveMode && events.length < 2) {
      throw new Error('Replayer need at least 2 events.');
    }
    this.config = Object.assign({}, defaultConfig, config);

    this.handleResize = this.handleResize.bind(this);
    this.getCastFn = this.getCastFn.bind(this);
    this.emitter.on('resize', this.handleResize as Handler);

    smoothscroll.polyfill();
    polyfill();
    this.setupDom();

    this.service = createPlayerService(
      {
        events: events.map((e) => {
          if (config && config.unpackFn) {
            return config.unpackFn(e as string);
          }
          return e as eventWithTime;
        }),
        timer: new Timer(this.config),
        speed: config?.speed || defaultConfig.speed,
        timeOffset: 0,
        baselineTime: 0,
        lastPlayedEvent: null,
      },
      {
        getCastFn: this.getCastFn,
        emitter: this.emitter,
      },
    );
    this.service.start();
    this.service.subscribe((state) => {
      if (!state.changed) {
        return;
      }
      // publish via emitter
    });

    // rebuild first full snapshot as the poster of the player
    // maybe we can cache it for performance optimization
    const { events: contextEvents } = this.service.state.context;
    const firstMeta = contextEvents.find((e) => e.type === EventType.Meta);
    const firstFullsnapshot = contextEvents.find(
      (e) => e.type === EventType.FullSnapshot,
    );
    if (firstMeta) {
      const { width, height } = firstMeta.data as metaEvent['data'];
      this.emitter.emit(ReplayerEvents.Resize, {
        width,
        height,
      });
    }
    if (firstFullsnapshot) {
      this.rebuildFullSnapshot(
        firstFullsnapshot as fullSnapshotEvent & { timestamp: number },
      );
    }
  }

  public on(event: string, handler: Handler) {
    this.emitter.on(event, handler);
  }

  public setConfig(config: Partial<playerConfig>) {
    Object.keys(config).forEach((key) => {
      // @ts-ignore
      this.config[key] = config[key];
    });
    if (!this.config.skipInactive) {
      this.noramlSpeed = -1;
    }
  }

  public getMetaData(): playerMetaData {
    const { events } = this.service.state.context;
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    return {
      totalTime: lastEvent.timestamp - firstEvent.timestamp,
    };
  }

  public getCurrentTime(): number {
    return this.timer.timeOffset + this.getTimeOffset();
  }

  public getTimeOffset(): number {
    const { baselineTime, events } = this.service.state.context;
    return baselineTime - events[0].timestamp;
  }

  /**
   * This API was designed to be used as play at any time offset.
   * Since we minimized the data collected from recorder, we do not
   * have the ability of undo an event.
   * So the implementation of play at any time offset will always iterate
   * all of the events, cast event before the offset synchronously
   * and cast event after the offset asynchronously with timer.
   * @param timeOffset number
   */
  public play(timeOffset = 0) {
    this.service.send({ type: 'PLAY', payload: { timeOffset } });
    this.emitter.emit(ReplayerEvents.Start);
  }

  public pause() {
    this.service.send({ type: 'PAUSE' });
    this.emitter.emit(ReplayerEvents.Pause);
  }

  public resume(timeOffset = 0) {
    this.service.send({ type: 'RESUME', payload: { timeOffset } });
    this.emitter.emit(ReplayerEvents.Resume);
  }

  public startLive(baselineTime?: number) {
    this.service.send({ type: 'TO_LIVE', payload: { baselineTime } });
  }

  public addEvent(rawEvent: eventWithTime | string) {
    const event = this.config.unpackFn
      ? this.config.unpackFn(rawEvent as string)
      : (rawEvent as eventWithTime);
    Promise.resolve().then(() =>
      this.service.send({ type: 'ADD_EVENT', payload: { event } }),
    );
  }

  public enableInteract() {
    this.iframe.setAttribute('scrolling', 'auto');
    this.iframe.style.pointerEvents = 'auto';
  }

  public disableInteract() {
    this.iframe.setAttribute('scrolling', 'no');
    this.iframe.style.pointerEvents = 'none';
  }

  private setupDom() {
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('replayer-wrapper');
    this.config.root!.appendChild(this.wrapper);

    this.mouse = document.createElement('div');
    this.mouse.classList.add('replayer-mouse');
    this.wrapper.appendChild(this.mouse);

    this.iframe = document.createElement('iframe');
	this.iframe.setAttribute('sandbox', 'allow-same-origin');
    console.log("create_dom, modifiable is ", this.config.modifiable);
    this.config.modifiable ? this.enableInteract() : this.disableInteract();
    this.wrapper.appendChild(this.iframe);
  }

  private handleResize(dimension: viewportResizeDimention) {
    this.iframe.setAttribute('width', String(dimension.width));
    this.iframe.setAttribute('height', String(dimension.height));
  }

  private getCastFn(event: eventWithTime, isSync = false) {
    const { events } = this.service.state.context;
    let castFn: undefined | (() => void);
    switch (event.type) {
      case EventType.DomContentLoaded:
      case EventType.Load:
        break;
      case EventType.Custom:
        castFn = () => {
          /**
           * emit custom-event and pass the event object.
           *
           * This will add more value to the custom event and allows the client to react for custom-event.
           */
          this.emitter.emit(ReplayerEvents.CustomEvent, event);
        };
        break;
      case EventType.Meta:
        castFn = () =>
          this.emitter.emit(ReplayerEvents.Resize, {
            width: event.data.width,
            height: event.data.height,
          });
        break;
      case EventType.FullSnapshot:
        castFn = () => {
          this.rebuildFullSnapshot(event);
          this.iframe.contentWindow!.scrollTo(event.data.initialOffset);
        };
        break;
      case EventType.IncrementalSnapshot:
        castFn = () => {
          this.applyIncremental(event, isSync);
          if (event === this.nextUserInteractionEvent) {
            this.nextUserInteractionEvent = null;
            this.restoreSpeed();
          }
          if (this.config.skipInactive && !this.nextUserInteractionEvent) {
            for (const _event of events) {
              if (_event.timestamp! <= event.timestamp!) {
                continue;
              }
              if (this.isUserInteraction(_event)) {
                if (
                  _event.delay! - event.delay! >
                  SKIP_TIME_THRESHOLD * this.config.speed
                ) {
                  this.nextUserInteractionEvent = _event;
                }
                break;
              }
            }
            if (this.nextUserInteractionEvent) {
              this.noramlSpeed = this.config.speed;
              const skipTime =
                this.nextUserInteractionEvent.delay! - event.delay!;
              const payload = {
                speed: Math.min(Math.round(skipTime / SKIP_TIME_INTERVAL), 360),
              };
              this.setConfig(payload);
              this.emitter.emit(ReplayerEvents.SkipStart, payload);
            }
          }
        };
        break;
      default:
    }
    const wrappedCastFn = () => {
      if (castFn) {
        castFn();
      }
      this.service.send({ type: 'CAST_EVENT', payload: { event } });
      if (event === events[events.length - 1]) {
        this.restoreSpeed();
        this.service.send('END');
        this.emitter.emit(ReplayerEvents.Finish);
      }
    };
    return wrappedCastFn;
  }

  private rebuildFullSnapshot(
    event: fullSnapshotEvent & { timestamp: number },
  ) {
    if (Object.keys(this.legacy_missingNodeRetryMap).length) {
      console.warn(
        'Found unresolved missing node map',
        this.legacy_missingNodeRetryMap,
      );
    }
    this.legacy_missingNodeRetryMap = {};
    mirror.map = rebuild(event.data.node, this.iframe.contentDocument!)[1];
    const styleEl = document.createElement('style');
    const { documentElement, head } = this.iframe.contentDocument!;
    documentElement!.insertBefore(styleEl, head);
    const injectStylesRules = getInjectStyleRules(
      this.config.blockClass,
    ).concat(this.config.insertStyleRules);
    for (let idx = 0; idx < injectStylesRules.length; idx++) {
      (styleEl.sheet! as CSSStyleSheet).insertRule(injectStylesRules[idx], idx);
    }
    this.emitter.emit(ReplayerEvents.FullsnapshotRebuilded);
    this.waitForStylesheetLoad();
  }

  /**
   * pause when loading style sheet, resume when loaded all timeout exceed
   */
  private waitForStylesheetLoad() {
    const { head } = this.iframe.contentDocument!;
    if (head) {
      const unloadSheets: Set<HTMLLinkElement> = new Set();
      let timer: number;
      let beforeLoadState = this.service.state;
      head
        .querySelectorAll('link[rel="stylesheet"]')
        .forEach((css: HTMLLinkElement) => {
          if (!css.sheet) {
            unloadSheets.add(css);
            css.addEventListener('load', () => {
              unloadSheets.delete(css);
              // all loaded and timer not released yet
              if (unloadSheets.size === 0 && timer !== -1) {
                if (beforeLoadState.matches('playing')) {
                  this.resume(this.getCurrentTime());
                }
                this.emitter.emit(ReplayerEvents.LoadStylesheetEnd);
                if (timer) {
                  window.clearTimeout(timer);
                }
              }
            });
          }
        });

      if (unloadSheets.size > 0) {
        // find some unload sheets after iterate
        this.service.send({ type: 'PAUSE' });
        this.emitter.emit(ReplayerEvents.LoadStylesheetStart);
        timer = window.setTimeout(() => {
          if (beforeLoadState.matches('playing')) {
            this.resume(this.getCurrentTime());
          }
          // mark timer was called
          timer = -1;
        }, this.config.loadTimeout);
      }
    }
  }

  private applyIncremental(
    e: incrementalSnapshotEvent & { timestamp: number },
    isSync: boolean,
  ) {
    const { baselineTime } = this.service.state.context;
    const { data: d } = e;
    switch (d.source) {
      case IncrementalSource.Mutation: {
        d.removes.forEach((mutation) => {
          const target = mirror.getNode(mutation.id);
          if (!target) {
            return this.warnNodeNotFound(d, mutation.id);
          }
          const parent = mirror.getNode(mutation.parentId);
          if (!parent) {
            return this.warnNodeNotFound(d, mutation.parentId);
          }
          // target may be removed with its parents before
          mirror.removeNodeFromMap(target);
          if (parent) {
            parent.removeChild(target);
          }
        });

        const legacy_missingNodeMap: missingNodeMap = {
          ...this.legacy_missingNodeRetryMap,
        };
        const queue: addedNodeMutation[] = [];

        const appendNode = (mutation: addedNodeMutation) => {
          const parent = mirror.getNode(mutation.parentId);
          if (!parent) {
            return queue.push(mutation);
          }

          let previous: Node | null = null;
          let next: Node | null = null;
          if (mutation.previousId) {
            previous = mirror.getNode(mutation.previousId) as Node;
          }
          if (mutation.nextId) {
            next = mirror.getNode(mutation.nextId) as Node;
          }
          // next not present at this moment
          if (mutation.nextId !== null && mutation.nextId !== -1 && !next) {
            return queue.push(mutation);
          }

          const target = buildNodeWithSN(
            mutation.node,
            this.iframe.contentDocument!,
            mirror.map,
            true,
          ) as Node;

          // legacy data, we should not have -1 siblings any more
          if (mutation.previousId === -1 || mutation.nextId === -1) {
            legacy_missingNodeMap[mutation.node.id] = {
              node: target,
              mutation,
            };
            return;
          }

          if (
            previous &&
            previous.nextSibling &&
            previous.nextSibling.parentNode
          ) {
            parent.insertBefore(target, previous.nextSibling);
          } else if (next && next.parentNode) {
            // making sure the parent contains the reference nodes
            // before we insert target before next.
            parent.contains(next)
              ? parent.insertBefore(target, next)
              : parent.insertBefore(target, null);
          } else {
            parent.appendChild(target);
          }

          if (mutation.previousId || mutation.nextId) {
            this.legacy_resolveMissingNode(
              legacy_missingNodeMap,
              parent,
              target,
              mutation,
            );
          }
        };

        d.adds.forEach((mutation) => {
          appendNode(mutation);
        });

        while (queue.length) {
          if (queue.every((m) => !Boolean(mirror.getNode(m.parentId)))) {
            return queue.forEach((m) => this.warnNodeNotFound(d, m.node.id));
          }
          const mutation = queue.shift()!;
          appendNode(mutation);
        }

        if (Object.keys(legacy_missingNodeMap).length) {
          Object.assign(this.legacy_missingNodeRetryMap, legacy_missingNodeMap);
        }

        d.texts.forEach((mutation) => {
          const target = mirror.getNode(mutation.id);
          if (!target) {
            return this.warnNodeNotFound(d, mutation.id);
          }
          target.textContent = mutation.value;
        });
        d.attributes.forEach((mutation) => {
          const target = mirror.getNode(mutation.id);
          if (!target) {
            return this.warnNodeNotFound(d, mutation.id);
          }
          for (const attributeName in mutation.attributes) {
            if (typeof attributeName === 'string') {
              const value = mutation.attributes[attributeName];
              if (value !== null) {
                ((target as Node) as Element).setAttribute(
                  attributeName,
                  value,
                );
              } else {
                ((target as Node) as Element).removeAttribute(attributeName);
              }
            }
          }
        });
        break;
      }
      case IncrementalSource.MouseMove:
        if (isSync) {
          const lastPosition = d.positions[d.positions.length - 1];
          this.moveAndHover(d, lastPosition.x, lastPosition.y, lastPosition.id);
        } else {
          d.positions.forEach((p) => {
            const action = {
              doAction: () => {
                this.moveAndHover(d, p.x, p.y, p.id);
              },
              delay: p.timeOffset + e.timestamp - baselineTime,
            };
            this.timer.addAction(action);
          });
        }
        break;
      case IncrementalSource.MouseInteraction: {
        /**
         * Same as the situation of missing input target.
         */
        if (d.id === -1) {
          break;
        }
        const event = new Event(MouseInteractions[d.type].toLowerCase());
        const target = mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        this.emitter.emit(ReplayerEvents.MouseInteraction, {
          type: d.type,
          target,
        });
        const { triggerFocus } = this.config;
        switch (d.type) {
          case MouseInteractions.Blur:
            if ('blur' in ((target as Node) as HTMLElement)) {
              ((target as Node) as HTMLElement).blur();
            }
            break;
          case MouseInteractions.Focus:
            if (triggerFocus && ((target as Node) as HTMLElement).focus) {
              ((target as Node) as HTMLElement).focus({
                preventScroll: true,
              });
            }
            break;
          case MouseInteractions.Click:
          case MouseInteractions.TouchStart:
          case MouseInteractions.TouchEnd:
            /**
             * Click has no visual impact when replaying and may
             * trigger navigation when apply to an <a> link.
             * So we will not call click(), instead we add an
             * animation to the mouse element which indicate user
             * clicked at this moment.
             */
            if (!isSync) {
              this.moveAndHover(d, d.x, d.y, d.id);
              this.mouse.classList.remove('active');
              // tslint:disable-next-line
              void this.mouse.offsetWidth;
              this.mouse.classList.add('active');
            }
            break;
          default:
            target.dispatchEvent(event);
        }
        break;
      }
      case IncrementalSource.Scroll: {
        /**
         * Same as the situation of missing input target.
         */
        if (d.id === -1) {
          break;
        }
        const target = mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        if ((target as Node) === this.iframe.contentDocument) {
          this.iframe.contentWindow!.scrollTo({
            top: d.y,
            left: d.x,
            behavior: isSync ? 'auto' : 'smooth',
          });
        } else {
          try {
            ((target as Node) as Element).scrollTop = d.y;
            ((target as Node) as Element).scrollLeft = d.x;
          } catch (error) {
            /**
             * Seldomly we may found scroll target was removed before
             * its last scroll event.
             */
          }
        }
        break;
      }
      case IncrementalSource.ViewportResize:
        this.emitter.emit(ReplayerEvents.Resize, {
          width: d.width,
          height: d.height,
        });
        break;
      case IncrementalSource.Input: {
        /**
         * Input event on an unserialized node usually means the event
         * was synchrony triggered programmatically after the node was
         * created. This means there was not an user observable interaction
         * and we do not need to replay it.
         */
        if (d.id === -1) {
          break;
        }
        const target = mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        try {
          ((target as Node) as HTMLInputElement).checked = d.isChecked;
          ((target as Node) as HTMLInputElement).value = d.text;
        } catch (error) {
          // for safe
        }
        break;
      }
      case IncrementalSource.MediaInteraction: {
        const target = mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }
        const mediaEl = (target as Node) as HTMLMediaElement;
        if (d.type === MediaInteractions.Pause) {
          mediaEl.pause();
        }
        if (d.type === MediaInteractions.Play) {
          if (mediaEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            mediaEl.play();
          } else {
            mediaEl.addEventListener('canplay', () => {
              mediaEl.play();
            });
          }
        }
        break;
      }
      case IncrementalSource.StyleSheetRule: {
        const target = mirror.getNode(d.id);
        if (!target) {
          return this.debugNodeNotFound(d, d.id);
        }

        const styleEl = (target as Node) as HTMLStyleElement;
        const styleSheet = <CSSStyleSheet>styleEl.sheet;

        if (d.adds) {
          d.adds.forEach(({ rule, index }) => {
            const _index =
              index === undefined
                ? undefined
                : Math.min(index, styleSheet.rules.length);
            try {
              styleSheet.insertRule(rule, _index);
            } catch (e) {
              /**
               * sometimes we may capture rules with browser prefix
               * insert rule with prefixs in other browsers may cause Error
               */
            }
          });
        }

        if (d.removes) {
          d.removes.forEach(({ index }) => {
            styleSheet.deleteRule(index);
          });
        }
        break;
      }
      default:
    }
  }

  private legacy_resolveMissingNode(
    map: missingNodeMap,
    parent: Node,
    target: Node,
    targetMutation: addedNodeMutation,
  ) {
    const { previousId, nextId } = targetMutation;
    const previousInMap = previousId && map[previousId];
    const nextInMap = nextId && map[nextId];
    if (previousInMap) {
      const { node, mutation } = previousInMap as missingNode;
      parent.insertBefore(node, target);
      delete map[mutation.node.id];
      delete this.legacy_missingNodeRetryMap[mutation.node.id];
      if (mutation.previousId || mutation.nextId) {
        this.legacy_resolveMissingNode(map, parent, node as Node, mutation);
      }
    }
    if (nextInMap) {
      const { node, mutation } = nextInMap as missingNode;
      parent.insertBefore(node, target.nextSibling);
      delete map[mutation.node.id];
      delete this.legacy_missingNodeRetryMap[mutation.node.id];
      if (mutation.previousId || mutation.nextId) {
        this.legacy_resolveMissingNode(map, parent, node as Node, mutation);
      }
    }
  }

  private moveAndHover(d: incrementalData, x: number, y: number, id: number) {
    this.mouse.style.left = `${x}px`;
    this.mouse.style.top = `${y}px`;
    const target = mirror.getNode(id);
    if (!target) {
      return this.debugNodeNotFound(d, id);
    }
    this.hoverElements((target as Node) as Element);
  }

  private hoverElements(el: Element) {
    this.iframe
      .contentDocument!.querySelectorAll('.\\:hover')
      .forEach((hoveredEl) => {
        hoveredEl.classList.remove(':hover');
      });
    let currentEl: Element | null = el;
    while (currentEl) {
      if (currentEl.classList) {
        currentEl.classList.add(':hover');
      }
      currentEl = currentEl.parentElement;
    }
  }

  private isUserInteraction(event: eventWithTime): boolean {
    if (event.type !== EventType.IncrementalSnapshot) {
      return false;
    }
    return (
      event.data.source > IncrementalSource.Mutation &&
      event.data.source <= IncrementalSource.Input
    );
  }

  private restoreSpeed() {
    if (this.noramlSpeed === -1) {
      return;
    }
    const payload = { speed: this.noramlSpeed };
    this.setConfig(payload);
    this.emitter.emit(ReplayerEvents.SkipEnd, payload);
    this.noramlSpeed = -1;
  }

  private warnNodeNotFound(d: incrementalData, id: number) {
    if (!this.config.showWarning) {
      return;
    }
    console.warn(REPLAY_CONSOLE_PREFIX, `Node with id '${id}' not found in`, d);
  }

  private debugNodeNotFound(d: incrementalData, id: number) {
    /**
     * There maybe some valid scenes of node not being found.
     * Because DOM events are macrotask and MutationObserver callback
     * is microtask, so events fired on a removed DOM may emit
     * snapshots in the reverse order.
     */
    if (!this.config.showDebug) {
      return;
    }
    // tslint:disable-next-line: no-console
    console.log(REPLAY_CONSOLE_PREFIX, `Node with id '${id}' not found in`, d);
  }
}
