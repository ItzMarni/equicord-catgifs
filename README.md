# CatGIFs for Vencord and Equicord

CatGIFs adds a CatGIFs tab to Discord's GIF picker. You can search the library, send GIFs, copy GIF links, and submit GIFs for review.

> [!IMPORTANT]
> This project is AI-generated with OpenAI Codex. I cannot reliably review outside code contributions. Please open an issue for bugs or suggestions instead of opening a pull request.

## Features

- Search and send CatGIFs from Discord's GIF picker.
- Right-click a CatGIFs result and choose **Copy GIF Link**.
- Submit a GIF from Discord on supported client builds.
- Submit images from Chrome, Edge, or Firefox with the browser uploader.

![Browsing CatGIFs in Discord](assets/catgifs-picker.gif)

## Client support

| Client build | Browse, search, send, and copy | Upload from Discord |
| --- | --- | --- |
| Equicord or Vencord injected into Discord Desktop | Yes | Yes |
| Equibop or Vesktop using a local `dist` build | Yes | Yes |
| Equicord or Vencord browser extension | Yes | Yes |
| Userscript | Yes | Yes |
| Standalone web build | Yes | Yes, when the image host allows browser access. |
| Discord without Equicord or Vencord | No | No |

Desktop builds use the native media downloader. Browser extension builds add a background download bridge, and the userscript uses its privileged request helper. Standalone web builds use the browser directly, so the image host must allow cross-origin requests. The build scripts apply the browser bridge automatically.

## Connect CatGIFs

Open CatGIFs in the plugin settings and select **Connect to CatGIFs**. Approve the device in the browser window. CatGIFs stores the device token in the client's DataStore.

Supported client builds add **Upload to CatGIFs** to Discord's GIF context menu. The server places each upload in the review queue.

![Uploading a GIF from Discord](assets/favorite-gif-upload.gif)

## Browser uploader

The [`extension`](extension) directory contains the CatGIFs browser uploader. After you connect it, right-click an image and choose **Upload to CatGIFs**.

The extension includes separate Manifest V3 packages for Chromium and Firefox. See [the browser extension guide](extension/README.md) for installation and permission details.

## Build the plugin

You need Git, Node.js 22 or newer, and Corepack. Clone this repository next to an Equicord or Vencord source checkout. Install the client checkout's dependencies before running the CatGIFs build script.

The scripts copy every file in `src` to `src/userplugins/catgifs`. Web builds also add the download bridge to the client's Chromium and Firefox extension files. The bridge requests access only to CatGIFs, Discord's media hosts, Tenor, and Giphy. The scripts accept these targets:

- `desktop` builds Discord Desktop and Vesktop/Equibop bundles. This is the default.
- `web` builds the client mod's browser extensions and userscript.
- `all` builds both sets.

### Windows

Open PowerShell as your normal user. Do not use an administrator window.

```powershell
git clone https://github.com/Equicord/Equicord.git
git clone https://github.com/ItzMarni/equicord-catgifs.git

cd Equicord
corepack pnpm install --frozen-lockfile

cd ..\equicord-catgifs
.\build.ps1 all
```

For Vencord, clone `https://github.com/Vendicated/Vencord.git` in place of Equicord. If the client checkout is not beside this repository, set its path before building:

```powershell
$env:CLIENT_DIR = "C:\path\to\Vencord"
.\build.ps1 all
```

### Linux and macOS

Run these commands in a terminal:

```sh
git clone https://github.com/Equicord/Equicord.git
git clone https://github.com/ItzMarni/equicord-catgifs.git

cd Equicord
corepack pnpm install --frozen-lockfile

cd ../equicord-catgifs
./build.sh all
```

For Vencord, clone `https://github.com/Vendicated/Vencord.git` in place of Equicord. Set `CLIENT_DIR` when the checkout lives elsewhere:

```sh
CLIENT_DIR=/path/to/Vencord ./build.sh all
```

### NixOS

The flake supplies Node.js, Corepack, and Git:

```sh
nix develop
cd ../Equicord
corepack pnpm install --frozen-lockfile
cd ../equicord-catgifs
./build.sh all
```

Set `CLIENT_DIR` as shown above when you use another checkout path.

## Install the client build

### Discord Desktop

Run the injector from the Equicord or Vencord checkout:

```sh
corepack pnpm inject
```

Select the Discord release you use, then restart Discord.

### Equibop or Vesktop

Open the app's developer settings and set **Equicord Location** or **Vencord Location** to the client checkout's `dist` directory. Quit the app and open it again.

### Browser extension or userscript build

The client mod writes its Chromium extension, Firefox extension, and userscript to `dist` after a web build. Follow the [Vencord source installation guide](https://docs.vencord.dev/installing/) or the [Equicord devbuild guide](https://github.com/Equicord/Equicord#installing-equicord-devbuild) for the matching browser.

## Settings

**API Base URL** defaults to `https://catgifs.marni.cc`. The plugin also accepts a localhost server for development. Restart the client after changing the URL so the build can apply its content security policy.

## Project scope

This repository contains the GPL-3.0-or-later client plugin and browser extension. The CatGIFs API and website are separate projects. CatGIFs is not affiliated with Discord, Vencord, Equicord, Vesktop, or Equibop.
