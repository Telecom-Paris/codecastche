# Theia and Docker

## Prerequisite:

- Have at least 2 gb of ram for your docker-machine.

If you do not have a docker-machine, you can create it by installing virtualbox and launching:
```
docker-machine create -d virtualbox --virtualbox-memory "2048" theia

```
## How to docker:

Create a docker container based on ubuntu:

```docker run -it -p 3100:3000 ubuntu```

Create project achitecture

```cd /root mkdir theia ; cd theia```

Install dependencies:
```
apt update && apt upgrade -y && apt install -y curl make gcc g++ git python nano
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.5/install.sh | bash
```

Reload bashrc and set up environnement:
```
source ~/.bashrc
export HOME=$(pwd)
```
Install and compile theia dependencies:
```
nvm install 10
npm install -g yarn
```

Write config file: 
```
{
  "private": true,
  "dependencies": {
    "@theia/callhierarchy": "latest",
    "@theia/file-search": "latest",
    "@theia/git": "latest",
    "@theia/json": "latest",
    "@theia/markers": "latest",
    "@theia/messages": "latest",
    "@theia/mini-browser": "latest",
    "@theia/navigator": "latest",
    "@theia/outline-view": "latest",
    "@theia/plugin-ext-vscode": "latest",
    "@theia/preferences": "latest",
    "@theia/preview": "latest",
    "@theia/search-in-workspace": "latest",
    "@theia/terminal": "latest"
  },
  "devDependencies": {
    "@theia/cli": "latest"
  },
  "scripts": {
    "prepare": "yarn run clean && yarn build && yarn run download:plugins",
    "clean": "theia clean",
    "build": "theia build --mode development",
    "start": "theia start --plugins=local-dir:plugins",
    "download:plugins": "theia download:plugins"
  },
  "theiaPluginsDir": "plugins",
  "theiaPlugins": {
    "vscode-builtin-css": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/css-1.39.1-prel.vsix",
    "vscode-builtin-html": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/html-1.39.1-prel.vsix",
    "vscode-builtin-javascript": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/javascript-1.39.1-prel.vsix",
    "vscode-builtin-json": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/json-1.39.1-prel.vsix",
    "vscode-builtin-markdown": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/markdown-1.39.1-prel.vsix",
    "vscode-builtin-npm": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/npm-1.39.1-prel.vsix",
    "vscode-builtin-scss": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/scss-1.39.1-prel.vsix",
    "vscode-builtin-typescript": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/typescript-1.39.1-prel.vsix",
    "vscode-builtin-typescript-language-features": "https://github.com/theia-ide/vscode-builtin-extensions/releases/download/v1.39.1-prel/typescript-language-features-1.39.1-prel.vsix"
  }
}
```

into a file named ```package.json``` --> ```nano package.json```

Compile theia:
```
yarn
yarn theia build
```

Start theia:
```
export THEIA_DEFAULT_PLUGINS=local-dir:$(pwd)plugins
node src-gen/backend/main.js $HOME --hostname=0.0.0.0
```
