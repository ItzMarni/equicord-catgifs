/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { sleep } from "@utils/misc";
import { OptionType } from "@utils/types";
import { React, useEffect, useRef, useState } from "@webpack/common";

import { apiBase, legacyUploadTokenKey, uploadTokenKey } from "./api";

const DEFAULT_ENDPOINT = "https://catgifs.marni.cc";
const API_ENDPOINT_SETTING = ["apiEndpoint"] satisfies ("apiEndpoint")[];
const REQUEST_TIMEOUT_MS = 15_000;
const cl = classNameFactory("vc-catgifs-");

export async function getStoredUploadToken(base: URL): Promise<string | undefined> {
    const key = uploadTokenKey(base);
    const current = await DataStore.get<string>(key);
    if (current) return current;

    const legacyKey = legacyUploadTokenKey(base);
    const legacy = await DataStore.get<string>(legacyKey);
    if (legacy) {
        await DataStore.set(key, legacy);
        await DataStore.del(legacyKey);
        return legacy;
    }
    return undefined;
}

export async function clearStoredUploadToken(base: URL): Promise<void> {
    await Promise.all([
        DataStore.del(uploadTokenKey(base)),
        DataStore.del(legacyUploadTokenKey(base))
    ]);
}

export const settings = definePluginSettings({
    keepPickerOpen: {
        type: OptionType.BOOLEAN,
        description: "Keep the CatGIFs picker open after sending a GIF.",
        default: false
    },
    apiEndpoint: {
        type: OptionType.STRING,
        displayName: "API Base URL",
        description: "CatGIFs server URL, such as https://catgifs.marni.cc or http://localhost:8080. Restart the client after changing this.",
        default: DEFAULT_ENDPOINT,
        restartNeeded: true,
        isValid(value: string) {
            return Boolean(apiBase(value)) || "Enter https://catgifs.marni.cc or a localhost URL.";
        }
    },
    connection: {
        type: OptionType.COMPONENT,
        description: "Connect your CatGIFs account to upload GIFs from Discord.",
        component: ConnectionSettings
    }
});

interface DeviceGrant {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readDeviceGrant(value: unknown): DeviceGrant | null {
    if (
        !isRecord(value) ||
        typeof value.device_code !== "string" ||
        typeof value.user_code !== "string" ||
        typeof value.verification_uri_complete !== "string" ||
        typeof value.expires_in !== "number" ||
        !Number.isFinite(value.expires_in) ||
        value.expires_in <= 0 ||
        typeof value.interval !== "number" ||
        !Number.isFinite(value.interval) ||
        value.interval < 0
    ) {
        return null;
    }

    return {
        device_code: value.device_code,
        user_code: value.user_code,
        verification_uri_complete: value.verification_uri_complete,
        expires_in: value.expires_in,
        interval: value.interval
    };
}

export function ConnectionSettings() {
    const { apiEndpoint } = settings.use(API_ENDPOINT_SETTING);
    const base = apiBase(apiEndpoint);
    const originKey = base?.origin ?? "";
    const [connected, setConnected] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [pendingGrant, setPendingGrant] = useState<{ code: string; url: string } | null>(null);
    const connectionAbort = useRef<AbortController | null>(null);

    useEffect(() => () => connectionAbort.current?.abort(), []);

    useEffect(() => {
        setConnected(false);
        if (!base) return;
        let cancelled = false;

        void getStoredUploadToken(base)
            .then(token => {
                if (!cancelled) setConnected(Boolean(token));
            })
            .catch(() => {
                if (!cancelled) setMessage("Could not read the local CatGIFs connection.");
            });

        return () => {
            cancelled = true;
        };
    }, [originKey]);

    const cancelConnect = () => {
        connectionAbort.current?.abort();
        connectionAbort.current = null;
        setBusy(false);
        setPendingGrant(null);
        setMessage("Connection cancelled.");
    };

    const connect = async () => {
        if (!base) {
            setMessage("Set API Base URL to catgifs.marni.cc or a localhost address before connecting.");
            return;
        }

        setBusy(true);
        setPendingGrant(null);
        setMessage("Starting secure connection…");
        connectionAbort.current?.abort();
        const controller = new AbortController();
        connectionAbort.current = controller;

        try {
            const start = await fetch(new URL("/api/equicord/device", base), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ device_name: "Discord client" }),
                credentials: "omit",
                redirect: "error",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            });
            if (!start.ok) {
                throw new Error(
                    start.status === 429
                        ? "Too many connection attempts. Try again in a minute."
                        : "Could not start the CatGIFs connection."
                );
            }

            const grant = readDeviceGrant(await start.json().catch(() => null));
            if (!grant) throw new Error("CatGIFs returned an invalid connection response.");
            if (!URL.canParse(grant.verification_uri_complete)) {
                throw new Error("CatGIFs returned an invalid approval URL.");
            }
            const verificationUrl = new URL(grant.verification_uri_complete);
            if (verificationUrl.origin !== base.origin) {
                throw new Error("CatGIFs returned an invalid approval URL.");
            }

            setPendingGrant({ code: grant.user_code, url: verificationUrl.href });
            setMessage(`Enter ${grant.user_code} in the browser window to approve this client.`);
            void VencordNative.native.openExternal(verificationUrl.href);

            const expiresAt = Date.now() + grant.expires_in * 1000;
            let interval = Math.max(5, grant.interval) * 1000;
            while (Date.now() < expiresAt) {
                await sleep(interval);
                if (controller.signal.aborted) return;

                const response = await fetch(new URL("/api/equicord/token", base), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ device_code: grant.device_code }),
                    credentials: "omit",
                    redirect: "error",
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
                });
                const payload: unknown = await response.json().catch(() => null);
                const result: Record<string, unknown> = isRecord(payload) ? payload : {};

                if (result.status === "authorized" && typeof result.access_token === "string" && result.access_token.length > 0) {
                    await DataStore.set(uploadTokenKey(base), result.access_token);
                    setPendingGrant(null);
                    setMessage("Connected. Right click any GIF in Discord to submit it for review.");
                    setConnected(true);
                    return;
                }
                if (result.status === "authorization_pending") continue;
                if (response.status === 429 || result.status === "slow_down") {
                    interval = Math.max(interval + 5000, 10_000);
                    continue;
                }
                if (result.status === "expired") {
                    throw new Error("That connection code expired. Start again to get a new one.");
                }
                if (result.status === "access_denied") {
                    throw new Error("The connection was denied or the account is no longer active.");
                }
                if (result.status === "device_limit_reached") {
                    throw new Error("This account already has the maximum number of connected devices.");
                }
                throw new Error(typeof result.error === "string" ? result.error : "Could not finish connecting to CatGIFs.");
            }
            throw new Error("That connection code expired. Start again to get a new one.");
        } catch (error) {
            if (controller.signal.aborted) return;
            setPendingGrant(null);
            setMessage(error instanceof Error ? error.message : "Could not connect to CatGIFs.");
        } finally {
            if (connectionAbort.current === controller) {
                connectionAbort.current = null;
                if (!controller.signal.aborted) setBusy(false);
            }
        }
    };

    const disconnect = async () => {
        if (!base) return;
        try {
            await clearStoredUploadToken(base);
            setConnected(false);
            setMessage("Disconnected.");
        } catch {
            setMessage("Could not remove the local CatGIFs token.");
        }
    };

    return (
        <div className={cl("connection-setting")}>
            <Paragraph>
                {connected
                    ? "This client is connected to CatGIFs."
                    : "Connect this client to upload GIFs from Discord. Approve it in your browser with no API key required."}
            </Paragraph>
            <div className={cl("connection-actions")}>
                {connected ? (
                    <>
                        <Button
                            variant="primary"
                            size="small"
                            disabled={!base}
                            onClick={() => {
                                if (base) void VencordNative.native.openExternal(new URL("/settings/equicord", base).href);
                            }}
                        >
                            Manage connected devices
                        </Button>
                        <Button variant="secondary" size="small" onClick={disconnect}>
                            Remove local token
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="primary" size="small" disabled={busy} onClick={connect}>
                            {busy ? "Waiting for approval…" : "Connect to CatGIFs"}
                        </Button>
                        {busy && pendingGrant && (
                            <>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => void VencordNative.native.openExternal(pendingGrant.url)}
                                >
                                    Open approval page
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => copyWithToast(pendingGrant.code, "Approval code copied.")}
                                >
                                    Copy code
                                </Button>
                            </>
                        )}
                        {busy && (
                            <Button variant="secondary" size="small" onClick={cancelConnect}>
                                Cancel
                            </Button>
                        )}
                    </>
                )}
            </div>
            {connected && (
                <Paragraph>
                    To revoke this credential, disconnect this device on the CatGIFs settings page. Removing the local token only disconnects this client.
                </Paragraph>
            )}
            {message && (
                <Paragraph role="status" className={cl("connection-message")}>
                    {message}
                </Paragraph>
            )}
        </div>
    );
}
