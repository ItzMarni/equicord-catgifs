> [!IMPORTANT]
> This project is AI-generated with OpenAI Codex. I cannot reliably review outside code contributions. Please open an issue for bugs or suggestions instead of opening a pull request.

# CatGIFs for Equicord

Adds a **CatGIFs** tab to Discord's existing Emoji, GIF, and Sticker picker. It uses the picker's search box and displays GIFs in responsive masonry columns, selecting them through Discord's normal GIF callback.

The **API Endpoint** setting defaults to `https://catgifs.marni.cc/api/gifs` and expects a JSON array of GIF URLs. Changing the endpoint requires restarting Equibop so its host can be added to the content security policy.

## Scope and support

This repository contains the open-source client plugin, licensed under GPL-3.0-or-later. The CatGIFs API and website are closed source and are not included here.

The plugin targets Equicord. Vencord and other clients are not tested or supported. This project is not affiliated with or supported by Vencord, Equicord, Discord, or Equibop. Please do not contact their support teams or communities about this plugin. Plugin-specific bug reports can be opened here, but support and compatibility fixes are not guaranteed.

## Development

I develop this on NixOS, and these instructions cover my Nix setup. If you use Windows or another environment, you are welcome to adapt them, but figuring out your setup is on you; I do not provide platform-specific setup or troubleshooting.

With an Equicord checkout next to this directory:

```sh
nix develop -c ./build.sh
```

By default, `build.sh` looks for Equicord in `../Equicord`. Set `EQUICORD_DIR` to use another checkout:

```sh
nix develop
EQUICORD_DIR=/path/to/Equicord ./build.sh
```

The script copies the plugin files into Equicord's `src/userplugins/catgifs` directory, then builds Equicord's development bundle. If dependencies are missing, install them from the Equicord checkout first:

```sh
cd /path/to/Equicord
corepack pnpm install --frozen-lockfile
```

## Load it in Equibop

Open Equibop settings, scroll to **Open Developer Settings**, then select the Equicord checkout's `dist` directory under **Equicord Location**. Fully quit and restart Equibop, then make sure CatGIFs is enabled in the plugin list.
