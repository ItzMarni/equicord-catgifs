/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "dist");
const files = ["background.js", "popup.css", "popup.html", "popup.js"];

await rm(output, { recursive: true, force: true });

for (const [browser, manifest] of [["chrome", "manifest.json"], ["firefox", "manifest.firefox.json"]]) {
    const directory = join(output, browser);
    await mkdir(directory, { recursive: true });
    await Promise.all(files.map(file => cp(join(root, file), join(directory, file))));
    await cp(join(root, "icons"), join(directory, "icons"), { recursive: true });
    await writeFile(join(directory, "manifest.json"), await readFile(join(root, manifest)));
}
