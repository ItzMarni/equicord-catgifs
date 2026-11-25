/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { detectImageMime } from "./api";

const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT = 30_000;

interface ExtensionMediaResult {
    success: boolean;
    data?: string;
    contentType?: string;
    fileName?: string;
    error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isExtensionMediaResult(value: unknown): value is ExtensionMediaResult {
    return isRecord(value) && typeof value.success === "boolean";
}

function normalizeFileName(rawName: string, contentType: string): string {
    let fileName = rawName;
    try {
        fileName = decodeURIComponent(rawName);
    } catch {
        fileName = rawName;
    }
    if (contentType === "image/gif" && !/\.gif$/i.test(fileName)) {
        return `${fileName.replace(/\.[a-z0-9]{1,6}$/i, "") || "discord-gif"}.gif`;
    }
    return fileName;
}

function downloadExtensionMedia(source: URL) {
    return new Promise<
        | { success: true; bytes: Uint8Array; contentType: string; fileName: string }
        | { success: false; error: string }
    >(resolve => {
        const id = crypto.randomUUID();
        const finish = (result: ExtensionMediaResult) => {
            clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
            if (!result.success || !result.data || !result.contentType || !result.fileName) {
                resolve({ success: false, error: result.error || "The browser extension could not download this image." });
                return;
            }

            try {
                const binary = atob(result.data);
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
                const contentType = detectImageMime(bytes) ?? result.contentType;
                resolve({
                    success: true,
                    bytes,
                    contentType,
                    fileName: normalizeFileName(result.fileName, contentType)
                });
            } catch {
                resolve({ success: false, error: "The browser extension returned invalid image data." });
            }
        };
        const handleMessage = (msgEvent: MessageEvent<unknown>) => {
            if (msgEvent.source !== window || msgEvent.origin !== window.location.origin || !isRecord(msgEvent.data)) return;
            if (
                msgEvent.data.type !== "catgifs:download-result" ||
                msgEvent.data.id !== id ||
                !isExtensionMediaResult(msgEvent.data.result)
            ) {
                return;
            }
            finish(msgEvent.data.result);
        };
        const timeout = setTimeout(
            () => finish({ success: false, error: "The browser extension timed out while downloading this image." }),
            REQUEST_TIMEOUT + 5_000
        );
        window.addEventListener("message", handleMessage);
        window.postMessage({ type: "catgifs:download", id, url: source.href }, window.location.origin);
    });
}

function isPrivateHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
    if (ipv4?.every(part => part <= 255)) {
        const [a, b, c] = ipv4;
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113)
        );
    }

    if (!host.includes(":")) return false;
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    return (
        host === "::" ||
        host === "::1" ||
        host.startsWith("::ffff:") ||
        host.startsWith("64:ff9b:") ||
        host.startsWith("2001::") ||
        host.startsWith("2001:0:") ||
        host.startsWith("2001:db8:") ||
        host.startsWith("2002:") ||
        (first & 0xfe00) === 0xfc00 ||
        (first & 0xffc0) === 0xfe80 ||
        (first & 0xff00) === 0xff00
    );
}

export async function downloadWebMedia(source: URL) {
    if (IS_EXTENSION) return downloadExtensionMedia(source);

    try {
        if (isPrivateHost(source.hostname)) {
            throw new Error("Private network media links cannot be uploaded.");
        }

        const response = await fetch(source, {
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT)
        });
        if (response.status === 404 || response.status === 410) {
            throw new Error("The selected media URL is unavailable (HTTP 404/410).");
        }
        if (!response.ok) {
            throw new Error(`The media host returned HTTP ${response.status}.`);
        }

        const headerType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "application/octet-stream";
        if (headerType !== "application/octet-stream" && !headerType.startsWith("image/")) {
            await response.body?.cancel();
            throw new Error("The media host did not return an image.");
        }

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
            await response.body?.cancel();
            throw new Error("This file is over the 24 MiB upload limit.");
        }

        let bytes: Uint8Array;
        if (response.body) {
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                size += value.byteLength;
                if (size > MAX_MEDIA_BYTES) {
                    await reader.cancel();
                    throw new Error("This file is over the 24 MiB upload limit.");
                }
                chunks.push(value);
            }

            bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
        } else {
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > MAX_MEDIA_BYTES) {
                throw new Error("This file is over the 24 MiB upload limit.");
            }
            bytes = new Uint8Array(buffer);
        }

        if (bytes.byteLength === 0) {
            throw new Error("The media host returned an empty response.");
        }

        const sniffed = detectImageMime(bytes);
        const contentType = sniffed ?? (headerType.startsWith("image/") ? headerType : null);
        if (!contentType) {
            throw new Error("The selected link did not return a valid image.");
        }

        const rawName = source.pathname.split("/").pop() || "discord-gif.gif";
        return {
            success: true as const,
            bytes,
            contentType,
            fileName: normalizeFileName(rawName, contentType)
        };
    } catch (error) {
        if ((IS_DISCORD_DESKTOP || IS_EQUIBOP) && error instanceof TypeError) {
            return {
                success: false as const,
                error: "Restart Discord to finish loading the CatGIFs native helper."
            };
        }
        return {
            success: false as const,
            error:
                error instanceof Error && error.name !== "TypeError"
                    ? error.message
                    : "The browser could not download this image. The image host may block cross-origin requests."
        };
    }
}
