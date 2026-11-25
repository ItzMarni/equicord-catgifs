/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const UPLOAD_TOKEN_KEY = "CatGIFs_uploadToken";
const LEGACY_UPLOAD_TOKEN_KEY = "catgifs-upload-token";

const DISCORD_EXTERNAL_PROXY_RE = /^https:\/\/images-ext-\d+\.discordapp\.net\/external\/[^/]+\/(https?)\/(.+)$/i;
const DISCORD_HOST_RE = /(?:^|\.)discord(?:app)?\.(?:com|net)$/i;
const MEDIA_EXT_RE = /\.(?:gif|webp|png|jpe?g|avif)(?:[?#]|$)/i;
const GIF_URL_IN_TEXT_RE = /https?:\/\/(?:[^\s<>()"']+\.gif(?:\?[^\s<>()"']*)?|(?:www\.)?(?:tenor\.com\/view|giphy\.com\/gifs)\/[^\s<>()"']+)/i;

export function getEndpoint(value: string): URL | null {
    const trimmed = value.trim();
    if (!URL.canParse(trimmed)) return null;

    const url = new URL(trimmed);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url : null;
}

export function apiBase(endpointValue: string): URL | null {
    const endpoint = getEndpoint(endpointValue);
    if (!endpoint) return null;

    const host = endpoint.hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    if (endpoint.origin !== "https://catgifs.marni.cc" && !local) return null;
    return new URL("/", endpoint);
}

export function uploadTokenKey(base: URL): string {
    return `${UPLOAD_TOKEN_KEY}:${base.origin}`;
}

export function legacyUploadTokenKey(base: URL): string {
    return `${LEGACY_UPLOAD_TOKEN_KEY}:${base.origin}`;
}

export function normalizeGifUrl(value: unknown, endpoint: URL): string | null {
    const raw = typeof value === "string"
        ? value
        : typeof value === "object" && value !== null && "url" in value && typeof value.url === "string"
            ? value.url
            : null;
    if (!raw) return null;

    try {
        const url = new URL(raw, endpoint);
        if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
        if (url.origin !== endpoint.origin || !/\.gif$/i.test(url.pathname)) return null;
        return url.href;
    } catch {
        return null;
    }
}

export function detectImageMime(bytes: Uint8Array): string | null {
    if (
        bytes.byteLength >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
    ) {
        return "image/gif";
    }
    if (
        bytes.byteLength >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return "image/webp";
    }
    if (
        bytes.byteLength >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47
    ) {
        return "image/png";
    }
    if (bytes.byteLength >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return "image/jpeg";
    }
    return null;
}

export function resolveGifSourceUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    if (!URL.canParse(withProtocol)) return null;

    let parsed = new URL(withProtocol);
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
        return null;
    }

    const proxyMatch = parsed.href.match(DISCORD_EXTERNAL_PROXY_RE);
    if (proxyMatch) {
        const unwrapped = `${proxyMatch[1].toLowerCase()}://${proxyMatch[2]}`;
        if (URL.canParse(unwrapped)) {
            parsed = new URL(unwrapped);
        }
    }

    const host = parsed.hostname.toLowerCase();

    if (DISCORD_HOST_RE.test(host)) {
        if (/^\/(?:emojis|stickers)\//i.test(parsed.pathname)) return null;
        if (/\.gif$/i.test(parsed.pathname)) {
            parsed.searchParams.delete("format");
            parsed.searchParams.delete("animated");
            parsed.searchParams.delete("width");
            parsed.searchParams.delete("height");
            parsed.searchParams.delete("quality");
        }
        return parsed.href;
    }

    if (host === "tenor.com" || host.endsWith(".tenor.com")) {
        const segs = parsed.pathname.split("/").filter(Boolean);
        const file = segs[segs.length - 1];
        const id = segs[segs.length - 2];
        if (file && id && /\.(?:mp4|webm)$/i.test(file)) {
            const gifId = id.replace(/Po$/, "d").replace(/P1$/, "AM");
            if (gifId !== id) {
                segs[segs.length - 2] = gifId;
                segs[segs.length - 1] = file.replace(/\.(?:mp4|webm)$/i, ".gif");
                parsed.pathname = `/${segs.join("/")}`;
                return parsed.href;
            }
        }
        return parsed.href;
    }

    if (host === "giphy.com" || host.endsWith(".giphy.com")) {
        const segs = parsed.pathname.split("/").filter(Boolean);
        if (segs[0] === "gifs" && segs[1]) {
            const gifId = segs[1].split("-").pop() ?? "";
            if (/^[A-Za-z0-9]{10,}$/.test(gifId)) return `https://i.giphy.com/${gifId}.gif`;
        }
        const file = segs[segs.length - 1];
        const maybeId = segs[segs.length - 2];
        if (file && maybeId && /^giphy\.(?:mp4|webp|gif)$/i.test(file) && /^[A-Za-z0-9]{10,}$/.test(maybeId)) {
            return `https://i.giphy.com/${maybeId}.gif`;
        }
        return parsed.href;
    }

    return parsed.href;
}

export function isUploadableMediaUrl(rawUrl: string): boolean {
    const resolved = resolveGifSourceUrl(rawUrl);
    if (!resolved) return false;

    const url = new URL(resolved);
    const host = url.hostname.toLowerCase();
    if (MEDIA_EXT_RE.test(url.pathname)) return true;
    if (
        (host === "tenor.com" || host === "www.tenor.com") &&
        url.pathname.startsWith("/view/")
    ) {
        return true;
    }
    if (
        (host === "giphy.com" || host === "www.giphy.com") &&
        url.pathname.startsWith("/gifs/")
    ) {
        return true;
    }
    return false;
}

export function findGifUrlInText(content: string | undefined): string | null {
    if (!content) return null;
    const match = content.match(GIF_URL_IN_TEXT_RE);
    return match ? resolveGifSourceUrl(match[0]) : null;
}
