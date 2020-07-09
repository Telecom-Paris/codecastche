# Install Theia Plugin tools to developp Plugin for theia

#### This tutorial has been created from [this](https://theia-ide.org/docs/authoring_plugins) link

## Prerequisites:

- Having a linux based docker with theia installed (not official docker image)

## Let's install:

Install dependencies (as root):
```
apt install pkg-config libx11-dev libxkbfile-dev
```

Create his own folder:
```
mkdir /home/theia/theia/theia-plugin-extensionName
cd /home/theia/theia/theia-plugin-extensionName
```

Install dependencies (as theia user):
```
npm install -g yo generator-theia-extension
yo theia-extension
```

To recompile:
Make your modifcations, then go into browser-app parent
```
yarn lerna run prepare
```

