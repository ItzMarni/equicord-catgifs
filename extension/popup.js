/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const api = globalThis.browser ?? globalThis.chrome;
const status = document.getElementById("status");
const statusLabel = document.getElementById("status-label");
const statusShell = document.getElementById("status-shell");
const connect = document.getElementById("connect");
const manage = document.getElementById("manage");
const disconnect = document.getElementById("disconnect");

connect.addEventListener("click", async () => {
    connect.disabled = true;
    statusShell.dataset.state = "loading";
    statusLabel.textContent = "Connecting";
    status.textContent = "Starting secure connection…";
    try {
        const response = await api.runtime.sendMessage({ type: "connect" });
        if (!response?.ok) throw new Error(response?.error ?? "Could not connect to CatGIFs.");
        await refresh();
    } catch (error) {
        statusShell.dataset.state = "idle";
        statusLabel.textContent = "Not connected";
        status.textContent = error instanceof Error ? error.message : "Could not connect to CatGIFs.";
    } finally {
        connect.disabled = false;
    }
});

manage.addEventListener("click", async () => {
    const response = await api.runtime.sendMessage({ type: "open-settings" });
    if (!response?.ok) status.textContent = response?.error ?? "Could not open CatGIFs settings.";
});

disconnect.addEventListener("click", async () => {
    const response = await api.runtime.sendMessage({ type: "disconnect" });
    if (!response?.ok) {
        status.textContent = response?.error ?? "Could not disconnect from CatGIFs.";
        return;
    }
    await refresh();
});

api.storage.onChanged.addListener(() => {
    void refresh();
});

async function refresh() {
    const state = await api.storage.local.get(["accessToken", "pendingConnection", "statusMessage"]);
    const connected = typeof state.accessToken === "string";
    const pending = state.pendingConnection != null;
    const message = typeof state.statusMessage === "string" ? state.statusMessage : null;

    status.textContent = message
        ? message
        : connected
            ? "Connected. Right-click an image to upload it."
            : "Connect your CatGIFs account to start uploading.";
    statusShell.dataset.state = connected ? "connected" : pending ? "pending" : "idle";
    statusLabel.textContent = connected
        ? "Connected"
        : pending
            ? "Waiting for approval"
            : "Not connected";
    connect.hidden = connected || pending;
    manage.hidden = !connected;
    disconnect.hidden = !connected && !pending;
    disconnect.textContent = pending ? "Cancel connection" : "Disconnect";
}

void refresh();
