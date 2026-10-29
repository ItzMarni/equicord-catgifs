# CatGIFs browser uploader

The browser uploader adds **Upload to CatGIFs** to the image context menu. It uses CatGIFs device authorization and sends uploads to the review queue.

## Build browser packages

Install Node.js 22 or newer, then run:

```sh
node build.mjs
```

The script writes these unpacked packages:

- `dist/chrome` for Chrome, Edge, Brave, and other Chromium browsers.
- `dist/firefox` for Firefox.

The source directory also loads as a Chromium unpacked extension. Firefox needs its package because Firefox uses `background.scripts` while Chromium Manifest V3 uses `background.service_worker`.

## Chrome, Edge, and other Chromium browsers

Use Chromium 103 or newer.

1. Open `chrome://extensions`. Edge users can open `edge://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Select the `extension` directory or `extension/dist/chrome`.
5. Pin **CatGIFs Uploader** if you want its button on the toolbar.

## Firefox

1. Run `node build.mjs` from the `extension` directory.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Select `dist/firefox/manifest.json`.

Firefox removes temporary add-ons when the browser closes. Package and sign the extension through Mozilla Add-ons for a permanent install.

## Connect and upload

1. Open the CatGIFs Uploader popup.
2. Select **Connect to CatGIFs**.
3. Approve the device on the CatGIFs page.
4. Right-click an image and choose **Upload to CatGIFs**.

The toolbar badge shows upload progress. CatGIFs sends a browser notification after the server accepts or rejects the image.

## Permissions and storage

The extension asks for HTTP and HTTPS host access because image files can come from any public image host. It blocks localhost, private IP ranges, local network hostnames, and redirecting image URLs. The 24 MiB limit applies while the extension reads the response stream.

The extension stores its CatGIFs token in extension-local storage. Web pages cannot read it. Disconnecting removes the token and cancels pending device authorization.
