/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { CspPolicies, ImageSrc } from "@main/csp";
import { RendererSettings } from "@main/settings";
import type { IpcMainInvokeEvent } from "electron";

import { apiBase, detectImageMime, resolveGifSourceUrl } from "./api";

const DEFAULT_ENDPOINT = "https://catgifs.marni.cc";
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const MAX_HTML_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT = 30_000;
const apiEndpoint = RendererSettings.store.plugins?.CatGIFs?.apiEndpoint ?? DEFAULT_ENDPOINT;
const endpoint = apiBase(apiEndpoint) ?? new URL(DEFAULT_ENDPOINT);
const blockedAddresses = new BlockList();

CspPolicies["catgifs.marni.cc"] = ImageSrc;
CspPolicies[endpoint.host] = ImageSrc;
if (endpoint.protocol === "http:") {
    CspPolicies[endpoint.origin] = ImageSrc;
}

for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
    ["255.255.255.255", 32]
] as const) {
    blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["::ffff:0:0:0", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 32],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8]
] as const) {
    blockedAddresses.addSubnet(network, prefix, "ipv6");
}

class MediaDownloadError extends Error {}

function isBlockedAddress(address: string, family: number): boolean {
    const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
    return blockedAddresses.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function parseMediaUrl(value: unknown): URL {
    if (typeof value !== "string" || value.length > 8192) {
        throw new MediaDownloadError("This image URL is not supported.");
    }

    const resolved = resolveGifSourceUrl(value);
    if (!resolved) {
        throw new MediaDownloadError("Only HTTP or HTTPS media links can be uploaded.");
    }

    const url = new URL(resolved);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        throw new MediaDownloadError("Private network media links cannot be uploaded.");
    }

    const family = isIP(hostname);
    if (family && isBlockedAddress(hostname, family)) {
        throw new MediaDownloadError("Private network media links cannot be uploaded.");
    }

    return url;
}

const safeDnsLookup: LookupFunction = (hostname, options, callback) => {
    const cleanHost = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (cleanHost === "localhost" || cleanHost.endsWith(".localhost") || cleanHost.endsWith(".local")) {
        callback(new MediaDownloadError("Private network media links cannot be uploaded."), "", 4);
        return;
    }

    const literalFamily = isIP(cleanHost);
    if (literalFamily) {
        if (isBlockedAddress(cleanHost, literalFamily)) {
            callback(new MediaDownloadError("Private network media links cannot be uploaded."), "", 4);
            return;
        }
        if (options.all) {
            callback(null, [{ address: cleanHost, family: literalFamily }]);
        } else {
            callback(null, cleanHost, literalFamily);
        }
        return;
    }

    lookup(cleanHost, { all: true, verbatim: true })
        .then(addresses => {
            if (
                addresses.length === 0 ||
                addresses.some(({ address, family }) => isBlockedAddress(address, family))
            ) {
                callback(new MediaDownloadError("Private network media links cannot be uploaded."), "", 4);
                return;
            }
            if (options.all) {
                callback(null, addresses);
            } else {
                callback(null, addresses[0].address, addresses[0].family);
            }
        })
        .catch(() => {
            callback(new MediaDownloadError("The media host could not be resolved."), "", 4);
        });
};

function requestOnce(url: URL, deadline: number): Promise<IncomingMessage> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        return Promise.reject(new MediaDownloadError("Timed out while downloading media."));
    }

    const client = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const req = client.request(
            url,
            {
                method: "GET",
                lookup: safeDnsLookup,
                timeout: remaining,
                headers: {
                    Accept: "image/gif,image/*,*/*;q=0.8",
                    "Accept-Encoding": "identity",
                    "User-Agent": "Mozilla/5.0 (compatible; CatGIFs/1.0)"
                }
            },
            res => resolve(res)
        );

        req.on("timeout", () => {
            req.destroy(new MediaDownloadError("Timed out while downloading media."));
        });
        req.on("error", err => {
            reject(err instanceof MediaDownloadError ? err : new MediaDownloadError("Could not download this image."));
        });
        req.end();
    });
}

async function readStreamBytes(res: IncomingMessage, maxBytes: number, limitMessage: string, deadline: number): Promise<Uint8Array> {
    const contentLength = Number(res.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        res.destroy();
        throw new MediaDownloadError(limitMessage);
    }

    const encoding = res.headers["content-encoding"]?.toLowerCase();
    const stream = encoding === "gzip"
        ? res.pipe(createGunzip())
        : encoding === "deflate"
            ? res.pipe(createInflate())
            : encoding === "br"
                ? res.pipe(createBrotliDecompress())
                : res;

    return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const timer = setTimeout(() => {
            res.destroy();
            stream.destroy();
            reject(new MediaDownloadError("Timed out while downloading media."));
        }, Math.max(1, deadline - Date.now()));

        const cleanup = () => clearTimeout(timer);

        stream.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > maxBytes) {
                cleanup();
                res.destroy();
                stream.destroy();
                reject(new MediaDownloadError(limitMessage));
                return;
            }
            chunks.push(chunk);
        });
        stream.on("end", () => {
            cleanup();
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            resolve(bytes);
        });
        stream.on("error", err => {
            cleanup();
            res.destroy();
            reject(err instanceof MediaDownloadError ? err : new MediaDownloadError("Could not download this image."));
        });
    });
}

async function fetchFollowingRedirects(initialUrl: URL, deadline: number): Promise<{ res: IncomingMessage; url: URL }> {
    let url = initialUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        const res = await requestOnce(url, deadline);
        const status = res.statusCode ?? 0;
        if (status < 300 || status >= 400) {
            return { res, url };
        }

        const { location } = res.headers;
        res.destroy();
        if (!location || redirects === MAX_REDIRECTS) {
            throw new MediaDownloadError("The media host redirected too many times.");
        }
        url = parseMediaUrl(new URL(location, url).href);
    }

    throw new MediaDownloadError("The media host redirected too many times.");
}

function isGifPageHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === "tenor.com" || host === "www.tenor.com" || host === "giphy.com" || host === "www.giphy.com";
}

function extractGifFromHtml(html: string, baseUrl: URL): URL | null {
    const metaTags = html.match(/<meta\b[^>]{1,500}>/gi) ?? [];
    for (const tag of metaTags) {
        if (!/(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag)) continue;
        const contentMatch = tag.match(/content=["']([^"']+)["']/i);
        if (!contentMatch) continue;
        const decoded = contentMatch[1].replaceAll("&amp;", "&");
        try {
            const candidate = parseMediaUrl(new URL(decoded, baseUrl).href);
            if (/\.gif$/i.test(candidate.pathname)) return candidate;
        } catch {
            continue;
        }
    }
    return null;
}

function getFileName(url: URL, contentType: string): string {
    const encodedName = url.pathname.split("/").pop() || "discord-gif.gif";
    let decoded = encodedName;
    try {
        decoded = decodeURIComponent(encodedName);
    } catch {
        decoded = encodedName;
    }
    if (contentType === "image/gif" && !/\.gif$/i.test(decoded)) {
        return `${decoded.replace(/\.[a-z0-9]{1,6}$/i, "") || "discord-gif"}.gif`;
    }
    return decoded;
}

export async function downloadGifMedia(_: IpcMainInvokeEvent, source: unknown) {
    const deadline = Date.now() + REQUEST_TIMEOUT;
    try {
        const initialUrl = parseMediaUrl(source);
        let { res, url } = await fetchFollowingRedirects(initialUrl, deadline);
        let status = res.statusCode ?? 0;

        if (status === 404 || status === 410) {
            res.destroy();
            throw new MediaDownloadError("The selected media URL is unavailable (HTTP 404/410).");
        }
        if (status < 200 || status >= 300) {
            res.destroy();
            throw new MediaDownloadError(`The media host returned HTTP ${status}.`);
        }

        let headerType = res.headers["content-type"]?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
        if (headerType === "text/html" && isGifPageHost(url.hostname)) {
            const htmlBytes = await readStreamBytes(res, MAX_HTML_BYTES, "The selected link did not return an image.", deadline);
            const html = new TextDecoder().decode(htmlBytes);
            const extractedUrl = extractGifFromHtml(html, url);
            if (!extractedUrl) {
                throw new MediaDownloadError("Could not find a GIF on that page.");
            }
            ({ res, url } = await fetchFollowingRedirects(extractedUrl, deadline));
            status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
                res.destroy();
                throw new MediaDownloadError(`The media host returned HTTP ${status}.`);
            }
            headerType = res.headers["content-type"]?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
        }

        if (headerType !== "application/octet-stream" && !headerType.startsWith("image/")) {
            res.destroy();
            throw new MediaDownloadError("The selected link did not return an image.");
        }

        const bytes = await readStreamBytes(res, MAX_MEDIA_BYTES, "This file is over the 24 MiB upload limit.", deadline);
        if (bytes.byteLength === 0) {
            throw new MediaDownloadError("The media host returned an empty response.");
        }

        const sniffedType = detectImageMime(bytes);
        const contentType = sniffedType ?? (headerType.startsWith("image/") ? headerType : null);
        if (!contentType) {
            throw new MediaDownloadError("The selected link did not return a valid image.");
        }

        return {
            success: true as const,
            bytes,
            contentType,
            fileName: getFileName(url, contentType)
        };
    } catch (error) {
        return {
            success: false as const,
            error: error instanceof MediaDownloadError ? error.message : "Could not download this image."
        };
    }
}
