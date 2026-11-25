/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin, { type PluginNative, ReporterTestable } from "@utils/types";
import * as WebpackCommon from "@webpack/common";
import { Menu, React, showToast } from "@webpack/common";
import type { ComponentType } from "react";

import {
    apiBase,
    findGifUrlInText,
    isUploadableMediaUrl,
    resolveGifSourceUrl
} from "./api";
import { clearStoredUploadToken, getStoredUploadToken, settings } from "./ConnectionSettings";
import { CatGIFsPicker, type ExpressionPickerTabProps } from "./GifPicker";
import managedStyle from "./styles.css?managed";
import { downloadWebMedia } from "./web";

const CATGIFS_VIEW = "catgifs";
const Native = VencordNative?.pluginHelpers?.CatGIFs as PluginNative<typeof import("./native")> | undefined;
const logger = new Logger("CatGIFs");
const activeUploads = new Set<string>();

interface ModernToastOptions {
    text: string;
    variant?: "success" | "critical";
}

type CrossClientShowToast =
    | ((message: string, type: "success" | "failure" | "message") => void)
    | ((options: ModernToastOptions) => void);

const crossClientShowToast: CrossClientShowToast = showToast;

interface ContextMediaAttachment {
    url?: string;
    proxy_url?: string;
    content_type?: string;
}

interface ContextMediaEmbed {
    url?: string;
    image?: { url?: string; proxyURL?: string };
    video?: { url?: string; proxyURL?: string };
    thumbnail?: { url?: string; proxyURL?: string };
}

interface ContextMessage {
    content?: string;
    attachments?: ContextMediaAttachment[];
    embeds?: ContextMediaEmbed[];
    messageSnapshots?: Array<{ message?: ContextMessage }>;
}

interface MessageContextProps {
    favoriteableType?: string;
    src?: unknown;
    url?: unknown;
    href?: unknown;
    itemSrc?: unknown;
    itemHref?: unknown;
    mediaItem?: { url?: unknown; proxyUrl?: unknown; contentType?: unknown };
    attachment?: ContextMediaAttachment;
    message?: ContextMessage;
}

interface ImageContextProps {
    src?: unknown;
    url?: unknown;
    href?: unknown;
    itemSrc?: unknown;
    itemHref?: unknown;
}

interface GifPickerContextProps {
    src?: unknown;
    url?: unknown;
    link?: unknown;
    itemSrc?: unknown;
    itemHref?: unknown;
    gif?: { src?: unknown; url?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function notifyUpload(message: string, type: "success" | "failure" | "info") {
    try {
        if ("Toasts" in WebpackCommon) {
            const legacyType = type === "info" ? "message" : type;
            (crossClientShowToast as (text: string, kind: "success" | "failure" | "message") => void)(message, legacyType);
        } else if (type === "info") {
            (crossClientShowToast as (options: ModernToastOptions) => void)({ text: message });
        } else {
            (crossClientShowToast as (options: ModernToastOptions) => void)({
                text: message,
                variant: type === "success" ? "success" : "critical"
            });
        }
    } catch (error) {
        logger.error("Could not show upload notification:", error);
    }
}

async function uploadGif(urlValue: string) {
    const resolved = resolveGifSourceUrl(urlValue);
    if (!resolved) {
        notifyUpload("This media link is not supported.", "failure");
        return;
    }
    if (activeUploads.has(resolved)) {
        notifyUpload("Already uploading this GIF to CatGIFs.", "info");
        return;
    }

    activeUploads.add(resolved);
    try {
        const base = apiBase(settings.plain.apiEndpoint);
        if (!base) {
            notifyUpload("Set API Base URL to catgifs.marni.cc or a localhost address first.", "failure");
            return;
        }
        const token = await getStoredUploadToken(base);
        if (!token) {
            notifyUpload("Connect CatGIFs in plugin settings first.", "failure");
            return;
        }

        notifyUpload("Uploading GIF to CatGIFs…", "info");
        const media = Native?.downloadGifMedia
            ? await Native.downloadGifMedia(resolved)
            : await downloadWebMedia(new URL(resolved));
        if (!media.success) throw new Error(media.error);

        let fileName = media.fileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "discord-gif.gif";
        if (!/\.gif$/i.test(fileName) && media.contentType === "image/gif") {
            fileName += ".gif";
        }

        const form = new FormData();
        form.append("file", new File([new Uint8Array(media.bytes)], fileName, { type: media.contentType }));

        const response = await fetch(new URL("/api/equicord/uploads", base), {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(30_000)
        });
        const payload: unknown = await response.json().catch(() => ({}));
        const result: Record<string, unknown> = isRecord(payload) ? payload : {};
        if (!response.ok) {
            logger.error("Upload API rejected the downloaded media", {
                status: response.status,
                error: result.error,
                fileName,
                bytes: media.bytes.byteLength,
                contentType: media.contentType
            });
            if (response.status === 401) {
                await clearStoredUploadToken(base);
                notifyUpload("CatGIFs connection expired or was revoked. Reconnect in plugin settings.", "failure");
            } else {
                notifyUpload(typeof result.error === "string" ? result.error : "CatGIFs could not accept this GIF.", "failure");
            }
            return;
        }
        notifyUpload("GIF submitted to CatGIFs for review.", "success");
    } catch (error) {
        logger.error("GIF upload failed:", error);
        notifyUpload(error instanceof Error ? error.message : "Could not upload this GIF.", "failure");
    } finally {
        activeUploads.delete(resolved);
    }
}

function buildUploadMenuItem(source: string) {
    return (
        <Menu.MenuItem
            id="catgifs-upload-gif"
            key="catgifs-upload-gif"
            label="Upload to CatGIFs"
            action={() => void uploadGif(source)}
        />
    );
}

function firstUploadableUrl(candidates: readonly unknown[]): string | null {
    for (const candidate of candidates) {
        if (typeof candidate !== "string" || !isUploadableMediaUrl(candidate)) continue;
        const resolved = resolveGifSourceUrl(candidate);
        if (resolved) return resolved;
    }
    return null;
}

function resolveAttachmentUrl(attachment: ContextMediaAttachment | undefined): string | null {
    if (!attachment) return null;
    const raw = attachment.url ?? attachment.proxy_url;
    if (typeof raw !== "string") return null;
    if (attachment.content_type?.startsWith("image/")) {
        return resolveGifSourceUrl(raw);
    }
    return isUploadableMediaUrl(raw) ? resolveGifSourceUrl(raw) : null;
}

function extractMessageMediaUrl(props: MessageContextProps | undefined): string | null {
    if (!props) return null;
    if (props.favoriteableType === "emoji" || props.favoriteableType === "sticker") return null;

    if (props.mediaItem) {
        const mediaUrl = typeof props.mediaItem.url === "string"
            ? props.mediaItem.url
            : typeof props.mediaItem.proxyUrl === "string"
                ? props.mediaItem.proxyUrl
                : null;
        if (mediaUrl) {
            if (typeof props.mediaItem.contentType === "string" && props.mediaItem.contentType.startsWith("image/")) {
                const resolved = resolveGifSourceUrl(mediaUrl);
                if (resolved) return resolved;
            }
            if (isUploadableMediaUrl(mediaUrl)) {
                const resolved = resolveGifSourceUrl(mediaUrl);
                if (resolved) return resolved;
            }
        }
    }

    const directAttachment = resolveAttachmentUrl(props.attachment);
    if (directAttachment) return directAttachment;

    const directItem = firstUploadableUrl([props.itemSrc, props.itemHref, props.src, props.url, props.href]);
    if (directItem) return directItem;

    const msg = props.message?.messageSnapshots?.[0]?.message ?? props.message;
    if (!msg) return null;

    if (msg.attachments) {
        for (const attachment of msg.attachments) {
            const url = resolveAttachmentUrl(attachment);
            if (url) return url;
        }
    }

    if (msg.embeds) {
        for (const embed of msg.embeds) {
            const embedUrl = firstUploadableUrl([
                embed.video?.url,
                embed.video?.proxyURL,
                embed.image?.url,
                embed.image?.proxyURL,
                embed.thumbnail?.url,
                embed.thumbnail?.proxyURL,
                embed.url
            ]);
            if (embedUrl) return embedUrl;
        }
    }

    return findGifUrlInText(msg.content);
}

const gifPickerContextMenu: NavContextMenuPatchCallback = (children, props: GifPickerContextProps | undefined) => {
    if (!props) return;
    if (children.some(child => child?.props?.id === "catgifs-upload-gif")) return;
    const source = firstUploadableUrl([
        props.src,
        props.gif?.src,
        props.itemSrc,
        props.url,
        props.link,
        props.gif?.url,
        props.itemHref
    ]);
    if (!source) return;
    children.push(buildUploadMenuItem(source));
};

const imageContextMenu: NavContextMenuPatchCallback = (children, props: ImageContextProps | undefined) => {
    if (!props) return;
    const source = firstUploadableUrl([props.src, props.url, props.href, props.itemSrc, props.itemHref]);
    if (!source) return;

    const group = findGroupChildrenByChildId(["save-image", "copy-native-link"], children) ?? children;
    if (group.some(child => child?.props?.id === "catgifs-upload-gif")) return;
    group.push(buildUploadMenuItem(source));
};

const messageContextMenu: NavContextMenuPatchCallback = (children, props: MessageContextProps | undefined) => {
    const source = extractMessageMediaUrl(props);
    if (!source) return;

    const group = findGroupChildrenByChildId(["save-image", "copy-native-link", "open-native-link", "copy-link"], children);
    if (group) {
        if (!group.some(child => child?.props?.id === "catgifs-upload-gif")) {
            group.push(buildUploadMenuItem(source));
        }
        return;
    }

    if (children.some(child => child?.key === "catgifs-upload-group" || child?.props?.id === "catgifs-upload-gif")) return;
    const menuGroup = (
        <Menu.MenuGroup key="catgifs-upload-group">
            {buildUploadMenuItem(source)}
        </Menu.MenuGroup>
    );
    if (children.length > 0) {
        children.splice(-1, 0, menuGroup);
    } else {
        children.push(menuGroup);
    }
};

function CatGIFsTab({
    Tab,
    activeView
}: {
    Tab: ComponentType<ExpressionPickerTabProps>;
    activeView: string;
}) {
    return (
        <Tab
            id="catgifs-picker-tab"
            aria-controls="catgifs-picker-tab-panel"
            aria-selected={activeView === CATGIFS_VIEW}
            isActive={activeView === CATGIFS_VIEW}
            viewType={CATGIFS_VIEW}
        >
            CatGIFs
        </Tab>
    );
}

const SafeCatGIFsTab = ErrorBoundary.wrap(CatGIFsTab, { noop: true });
const SafeCatGIFsPicker = ErrorBoundary.wrap(CatGIFsPicker, { noop: true });

export default definePlugin({
    name: "CatGIFs",
    description: "Add GIFs from a custom endpoint to the expression picker and upload GIFs from Discord.",
    authors: [{ name: "marni_", id: 282905846457827330n }],
    tags: ["Chat", "Media"],
    enabledByDefault: true,
    reporterTestable: ReporterTestable.Patches,
    settings,
    managedStyle,
    contextMenus: {
        "gif-picker": gifPickerContextMenu,
        "image-context": imageContextMenu,
        "message": messageContextMenu,
        "attachment-link-context": imageContextMenu
    },

    patches: [
        {
            find: "#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}",
            group: true,
            replacement: [
                {
                    match: /(?:\i(?:&&|\?))+\(0,\i\.jsx\)\((\i),\{[^}]{0,80}?"aria-selected":(\i)===\i\.\i\.SOUNDBOARD.{0,200}?\}\)(?::null)?(?=,|])/,
                    replace: "$&,$self.renderCatTab($1,$2)"
                },
                {
                    match: /(?<=(\i)===\i\.\i\.GIF.{0,160}?onSelectGIF:(\i).{0,350}?)\.STICKER&&.{0,200}?\}\):null(?=,|])/,
                    replace: "$&,$self.renderCatGIFsPicker($1,$2)"
                }
            ]
        }
    ],

    renderCatTab(Tab: ComponentType<ExpressionPickerTabProps>, activeView: string) {
        return <SafeCatGIFsTab key="catgifs-picker-tab" Tab={Tab} activeView={activeView} />;
    },

    renderCatGIFsPicker(activeView: string, onSelectGIF: (item: { url: string }) => void) {
        if (activeView !== CATGIFS_VIEW) return null;
        return <SafeCatGIFsPicker onSelectGIF={onSelectGIF} />;
    }
});
