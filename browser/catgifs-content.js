/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== "catgifs:download" || typeof event.data.id !== "string" || typeof event.data.url !== "string") return;

    const id = event.data.id;
    chrome.runtime.sendMessage({ action: "catgifsDownload", url: event.data.url }, (result) => {
        window.postMessage({
            type: "catgifs:download-result",
            id,
            result: chrome.runtime.lastError
                ? { success: false, error: "The browser extension could not download this image." }
                : result,
        }, window.location.origin);
    });
});
