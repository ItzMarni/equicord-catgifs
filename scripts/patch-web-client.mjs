/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = process.argv[2];
if (!clientDir) throw new Error("Pass the Equicord or Vencord checkout path.");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(scriptDir);
const browserDir = join(clientDir, "browser");
const contentPatch = await readFile(join(projectDir, "browser", "catgifs-content.js"), "utf8");
const backgroundPatch = await readFile(join(projectDir, "browser", "catgifs-background.js"), "utf8");

await appendOnce(join(browserDir, "content.js"), contentPatch, "catgifs:download-result");
await appendOnce(join(browserDir, "service-worker.js"), backgroundPatch, "catgifsDownload");
await appendOnce(join(browserDir, "background.js"), backgroundPatch, "catgifsDownload");
await patchManifest(join(browserDir, "manifest.json"), true);
await patchManifest(join(browserDir, "manifestv2.json"), false);

async function appendOnce(path, patch, marker) {
    const source = await readFile(path, "utf8");
    const markerIndex = source.indexOf(marker);
    const original = markerIndex === -1 ? source : source.slice(0, source.lastIndexOf("/*", markerIndex));
    await writeFile(path, `${original.trimEnd()}\n\n${patch}`);
}

async function patchManifest(path, manifestV3) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const permissions = manifestV3 ? manifest.host_permissions : manifest.permissions;
    const allowedHosts = [
        "https://*.discordapp.com/*",
        "https://*.discordapp.net/*",
        "https://*.tenor.com/*",
        "https://*.giphy.com/*",
        "https://catgifs.marni.cc/*",
    ];
    for (const permission of ["http://*/*", "https://*/*"]) {
        const index = permissions.indexOf(permission);
        if (index !== -1) permissions.splice(index, 1);
    }
    for (const permission of allowedHosts) {
        if (!permissions.includes(permission)) permissions.push(permission);
    }
    await writeFile(path, `${JSON.stringify(manifest, null, 4)}\n`);
}
