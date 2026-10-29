/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const API_BASE = "https://catgifs.marni.cc";
const CONTEXT_MENU_ID = "catgifs-upload-image";
const CONNECT_ALARM = "catgifs-connect";
const CLEAR_BADGE_ALARM = "catgifs-clear-badge";
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT = 30_000;
const api = globalThis.browser ?? globalThis.chrome;
const notificationIcon = api.runtime.getURL("icons/catgifs-128.png");

api.runtime.onInstalled.addListener(() => {
    void createContextMenu();
});

api.runtime.onStartup.addListener(() => {
    void createContextMenu();
});

api.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;

    if (typeof info.srcUrl !== "string") {
        void notify("CatGIFs", "This image does not have an uploadable link.");
        return;
    }

    void uploadImage(info.srcUrl);
});

api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CONNECT_ALARM) void pollConnection();
    if (alarm.name === CLEAR_BADGE_ALARM) void setBadge("", "#5865f2");
});

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isObject(message)) return false;

    let request;
    if (message.type === "connect") request = startConnection();
    if (message.type === "disconnect") request = disconnect();
    if (message.type === "open-settings") request = openSettings();
    if (!request) return false;

    request.then(
        (result) => sendResponse({ ok: true, result }),
        (error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "CatGIFs could not complete this request.",
        }),
    );
    return true;
});

async function createContextMenu() {
    await api.contextMenus.removeAll();
    api.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Upload to CatGIFs",
        contexts: ["image"],
    });
}

async function startConnection() {
    const response = await fetch(`${API_BASE}/api/equicord/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: "CatGIFs browser extension" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
        throw new Error(response.status === 429
            ? "Too many connection attempts. Try again in a minute."
            : "Could not start the CatGIFs connection.");
    }

    const grant = await response.json();
    if (!isDeviceGrant(grant)) throw new Error("CatGIFs returned an invalid connection response.");

    const verificationUrl = new URL(grant.verification_uri_complete);
    if (verificationUrl.origin !== API_BASE) throw new Error("CatGIFs returned an invalid approval URL.");

    await api.storage.local.set({
        pendingConnection: {
            deviceCode: grant.device_code,
            expiresAt: Date.now() + grant.expires_in * 1000,
            interval: Math.max(5, grant.interval),
            userCode: grant.user_code,
        },
        statusMessage: `Enter ${grant.user_code} in the opened CatGIFs page.`,
    });
    await api.tabs.create({ url: verificationUrl.href });
    await api.alarms.create(CONNECT_ALARM, { delayInMinutes: 0.5 });

    return { userCode: grant.user_code };
}

async function pollConnection() {
    const { pendingConnection } = await api.storage.local.get("pendingConnection");
    if (!isPendingConnection(pendingConnection)) return;
    const deviceCode = pendingConnection.deviceCode;

    if (Date.now() >= pendingConnection.expiresAt) {
        await finishConnection("That connection code expired. Start again to get a new one.", deviceCode);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/equicord/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device_code: pendingConnection.deviceCode }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        const result = await response.json();

        if (isObject(result) && result.status === "authorized" && typeof result.access_token === "string") {
            if (!(await isCurrentConnection(deviceCode))) return;
            await api.storage.local.set({
                accessToken: result.access_token,
                accessTokenConnection: deviceCode,
                statusMessage: "Connected. Right-click an image to upload it.",
            });
            if (!(await isCurrentConnection(deviceCode))) {
                const { accessTokenConnection } = await api.storage.local.get("accessTokenConnection");
                if (accessTokenConnection === deviceCode) {
                    await api.storage.local.remove(["accessToken", "accessTokenConnection"]);
                }
                const {
                    accessToken: currentToken,
                    pendingConnection: currentConnection,
                } = await api.storage.local.get(["accessToken", "pendingConnection"]);
                if (isPendingConnection(currentConnection)) {
                    await api.storage.local.set({
                        statusMessage: `Enter ${currentConnection.userCode} in the opened CatGIFs page.`,
                    });
                } else if (typeof currentToken !== "string") {
                    await api.storage.local.set({ statusMessage: "Disconnected." });
                }
                return;
            }
            await api.storage.local.remove("pendingConnection");
            await api.alarms.clear(CONNECT_ALARM);
            await notify("CatGIFs connected", "Right-click an image and choose Upload to CatGIFs.");
            return;
        }

        if (isObject(result) && result.status === "authorization_pending") {
            await schedulePoll(pendingConnection.interval, deviceCode);
            return;
        }

        if (response.status === 429) {
            pendingConnection.interval = Math.max(pendingConnection.interval + 5, 10);
            await schedulePoll(pendingConnection.interval, deviceCode);
            return;
        }

        const errors = {
            access_denied: "CatGIFs denied this connection, or the account is inactive.",
            device_limit_reached: "This account has reached its connected device limit.",
            expired: "That connection code expired. Start again to get a new one.",
        };
        const message = isObject(result) && typeof result.status === "string"
            ? errors[result.status]
            : undefined;
        await finishConnection(message ?? "Could not finish connecting to CatGIFs.", deviceCode);
    } catch {
        await schedulePoll(pendingConnection.interval, deviceCode);
    }
}

async function isCurrentConnection(deviceCode) {
    const { pendingConnection } = await api.storage.local.get("pendingConnection");
    return isPendingConnection(pendingConnection) && pendingConnection.deviceCode === deviceCode;
}

async function schedulePoll(seconds, deviceCode) {
    if (!(await isCurrentConnection(deviceCode))) return;
    await api.alarms.create(CONNECT_ALARM, { delayInMinutes: Math.max(seconds / 60, 0.5) });
}

async function finishConnection(message, deviceCode) {
    if (!(await isCurrentConnection(deviceCode))) return;
    await api.storage.local.set({ statusMessage: message });
    await api.storage.local.remove("pendingConnection");
    await api.alarms.clear(CONNECT_ALARM);
}

async function disconnect() {
    await api.storage.local.remove(["accessToken", "accessTokenConnection", "pendingConnection"]);
    await api.storage.local.set({ statusMessage: "Disconnected." });
    await api.alarms.clear(CONNECT_ALARM);
}

async function openSettings() {
    await api.tabs.create({ url: `${API_BASE}/settings/equicord` });
}

async function uploadImage(sourceValue) {
    const { accessToken } = await api.storage.local.get("accessToken");
    if (typeof accessToken !== "string") {
        await notify("Connect CatGIFs first", "Open the extension and connect your CatGIFs account.");
        return;
    }

    let source;
    try {
        source = parsePublicMediaUrl(sourceValue);
    } catch (error) {
        await notify("Upload failed", "This image link is not supported.");
        return;
    }

    if (/\.gif$/i.test(source.pathname) && source.searchParams.get("format") === "webp") {
        source.searchParams.set("format", "gif");
    }

    try {
        await setBadge("…", "#5865f2");
        const { response: mediaResponse, url: mediaUrl } = await fetchMedia(source);
        if (!mediaResponse.ok) throw new Error(`The image host returned HTTP ${mediaResponse.status}.`);
        const media = await readMedia(mediaResponse);
        const fileName = getFileName(mediaUrl, media.type);
        const form = new FormData();
        form.append("file", new File([media], fileName, { type: media.type }));

        const uploadResponse = await fetch(`${API_BASE}/api/equicord/uploads`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
        const result = await uploadResponse.json().catch(() => ({}));

        if (!uploadResponse.ok) {
            if (uploadResponse.status === 401) {
                await api.storage.local.remove(["accessToken", "accessTokenConnection"]);
                throw new Error("Your CatGIFs connection expired. Open the extension and reconnect.");
            }
            throw new Error(isObject(result) && typeof result.error === "string"
                ? result.error
                : "CatGIFs could not accept this image.");
        }

        await setBadge("✓", "#248046");
        await notify("Uploaded to CatGIFs", "CatGIFs added the image to the review queue.");
    } catch (error) {
        await setBadge("!", "#da373c");
        await notify("Upload failed", error instanceof Error ? error.message : "Could not upload this image.");
    } finally {
        await api.alarms.create(CLEAR_BADGE_ALARM, { delayInMinutes: 0.5 });
    }
}

function parsePublicMediaUrl(value) {
    if (typeof value !== "string" || value.length > 8192) throw new Error("This image link is not supported.");

    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        throw new Error("Only HTTP or HTTPS image links can be uploaded.");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
        throw new Error("Private network image links cannot be uploaded.");
    }

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
    if (ipv4?.every((part) => part <= 255)) {
        const [a, b, c] = ipv4;
        if (
            a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113)
        ) {
            throw new Error("Private network image links cannot be uploaded.");
        }
    }

    if (hostname.includes(":")) {
        const first = Number.parseInt(hostname.split(":")[0] || "0", 16);
        if (
            hostname === "::" || hostname === "::1" || hostname.startsWith("::ffff:") ||
            (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
            (first & 0xff00) === 0xff00 || hostname.startsWith("2001:db8:")
        ) {
            throw new Error("Private network image links cannot be uploaded.");
        }
    }

    return url;
}

async function fetchMedia(source) {
    let response;
    try {
        response = await fetch(source.href, {
            redirect: "manual",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
    } catch {
        throw new Error("Could not download this image.");
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new Error("Image links that redirect cannot be uploaded. Open the final image and try again.");
    }
    return { response, url: source };
}

async function readMedia(response) {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
        await response.body?.cancel();
        throw new Error("This file is over the 24 MiB upload limit.");
    }

    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!contentType.startsWith("image/")) {
        await response.body?.cancel();
        throw new Error("The image host did not return an image.");
    }
    if (!response.body) throw new Error("The image host returned an empty response.");

    const reader = response.body.getReader();
    const chunks = [];
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
    return new Blob(chunks, { type: contentType });
}

function getFileName(url, contentType) {
    const encodedName = url.pathname.split("/").pop() || "browser-image";
    let fileName;
    try {
        fileName = decodeURIComponent(encodedName);
    } catch {
        fileName = encodedName;
    }

    fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "browser-image";
    if (contentType === "image/gif" && !/\.gif$/i.test(fileName)) fileName += ".gif";
    if (!/\.[a-z0-9]{2,5}$/i.test(fileName)) {
        const extension = contentType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "");
        if (extension) fileName += `.${extension}`;
    }
    return fileName;
}

async function setBadge(text, color) {
    await api.action.setBadgeBackgroundColor({ color });
    await api.action.setBadgeText({ text });
}

async function notify(title, message) {
    await api.notifications.create({
        type: "basic",
        iconUrl: notificationIcon,
        title,
        message,
    });
}

function isObject(value) {
    return typeof value === "object" && value !== null;
}

function isDeviceGrant(value) {
    return isObject(value)
        && typeof value.device_code === "string"
        && typeof value.user_code === "string"
        && typeof value.verification_uri_complete === "string"
        && Number.isFinite(value.expires_in)
        && value.expires_in > 0
        && Number.isFinite(value.interval)
        && value.interval >= 0;
}

function isPendingConnection(value) {
    return isObject(value)
        && typeof value.deviceCode === "string"
        && typeof value.userCode === "string"
        && Number.isFinite(value.expiresAt)
        && Number.isFinite(value.interval);
}
