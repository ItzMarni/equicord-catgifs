/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const CATGIFS_MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const CATGIFS_REQUEST_TIMEOUT = 30_000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== "catgifsDownload" || typeof message.url !== "string") return false;

    let senderUrl;
    try {
        senderUrl = new URL(sender.url);
    } catch {
        return false;
    }
    if (senderUrl.hostname !== "discord.com" && !senderUrl.hostname.endsWith(".discord.com")) return false;

    catgifsDownload(message.url).then(sendResponse);
    return true;
});

async function catgifsDownload(value) {
    try {
        const source = catgifsPublicUrl(value);
        const response = await fetch(source, {
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(CATGIFS_REQUEST_TIMEOUT),
        });
        if (!response.ok) throw new Error(`The media host returned HTTP ${response.status}.`);

        const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
        if (!contentType.startsWith("image/")) throw new Error("The media host did not return an image.");

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > CATGIFS_MAX_MEDIA_BYTES) {
            throw new Error("This file is over the 24 MiB upload limit.");
        }

        if (!response.body) throw new Error("The media host returned an empty response.");
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            size += chunk.byteLength;
            if (size > CATGIFS_MAX_MEDIA_BYTES) {
                await reader.cancel();
                throw new Error("This file is over the 24 MiB upload limit.");
            }
            chunks.push(chunk);
        }

        const bytes = new Uint8Array(size);
        let byteOffset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, byteOffset);
            byteOffset += chunk.byteLength;
        }
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }

        const encodedName = source.pathname.split("/").pop() || "discord-gif.gif";
        let fileName;
        try {
            fileName = decodeURIComponent(encodedName);
        } catch {
            fileName = encodedName;
        }
        return { success: true, data: btoa(binary), contentType, fileName };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "The browser extension could not download this image.",
        };
    }
}

function catgifsPublicUrl(value) {
    if (value.length > 8192) throw new Error("This image URL is not supported.");

    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const allowedHost = host === "catgifs.marni.cc" || [
        ".discordapp.com",
        ".discordapp.net",
        ".tenor.com",
        ".giphy.com",
    ].some(suffix => host.endsWith(suffix));
    if (url.protocol !== "https:" || url.username || url.password || !allowedHost) {
        throw new Error("This image host is not supported by the browser extension.");
    }

    return url;
}
