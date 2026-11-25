/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { copyWithToast, insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { findComponentByCodeLazy, findCssClassesLazy } from "@webpack";
import {
    ContextMenuApi,
    ExpressionPickerStore,
    Menu,
    React,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "@webpack/common";
import type { ReactNode } from "react";

import { apiBase, normalizeGifUrl } from "./api";
import { settings } from "./ConnectionSettings";

const RESULT_WIDTH = 195;
const RESULT_GAP = 12;
const MAX_COLUMNS = 6;
const PICKER_SETTINGS = ["apiEndpoint", "keepPickerOpen"] satisfies ("apiEndpoint" | "keepPickerOpen")[];
const ScrollerClasses = findCssClassesLazy("scrollbarGutterStable", "thin", "scrollerBase", "fade");
const cl = classNameFactory("vc-catgifs-");

export interface ExpressionPickerTabProps {
    id?: string;
    "aria-controls"?: string;
    "aria-selected"?: boolean;
    isActive?: boolean;
    viewType: string;
    children?: ReactNode;
}

interface ManaSearchBarProps {
    autoFocus?: boolean;
    placeholder?: string;
    query?: string;
    onChange: (query: string) => void;
    onClear?: () => void;
}

interface PositionedGif {
    url: string;
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
}

const ManaSearchBar = findComponentByCodeLazy<ManaSearchBarProps>(".MagnifyingGlassIcon,onClear");

function gifName(url: string): string {
    try {
        const segment = new URL(url).pathname.split("/").pop() ?? "";
        return decodeURIComponent(segment)
            .replace(/\.gif$/i, "")
            .replaceAll(/[-_]+/g, " ")
            .trim() || "Cat GIF";
    } catch {
        return "Cat GIF";
    }
}

export function CatGIFsPicker({ onSelectGIF }: { onSelectGIF: (item: { url: string }) => void }) {
    const { apiEndpoint, keepPickerOpen } = settings.use(PICKER_SETTINGS);
    const query = ExpressionPickerStore.useExpressionPickerStore(store => store.searchQuery) ?? "";
    const activeViewType = ExpressionPickerStore.useExpressionPickerStore(store => store.activeViewType);
    const activeChannelId = ExpressionPickerStore.useExpressionPickerStore(store => store.activeChannelId);
    const [gifs, setGifs] = useState<string[]>([]);
    const [brokenUrls, setBrokenUrls] = useState<Record<string, true>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const [masonryWidth, setMasonryWidth] = useState(0);
    const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
    const viewportRef = useRef<HTMLDivElement>(null);
    const masonryRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const endpoint = apiBase(apiEndpoint);
        setLoading(true);
        setBrokenUrls({});

        if (!endpoint) {
            setError("Set API Base URL to https://catgifs.marni.cc or a localhost URL in CatGIFs settings.");
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        setError(null);

        fetch(new URL("/api/gifs", endpoint), {
            credentials: "omit",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
        })
            .then(async response => {
                if (!response.ok) throw new Error("The CatGIFs API returned an error.");

                const payload: unknown = await response.json();
                const list = Array.isArray(payload)
                    ? payload
                    : typeof payload === "object" && payload !== null && "gifs" in payload && Array.isArray(payload.gifs)
                        ? payload.gifs
                        : null;
                if (!list) throw new Error("The CatGIFs API did not return a GIF list.");

                setGifs([
                    ...new Set(
                        list.map(value => normalizeGifUrl(value, endpoint)).filter((url): url is string => url !== null)
                    )
                ]);
            })
            .catch(() => {
                if (!controller.signal.aborted) setError("Could not load GIFs from this endpoint.");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [apiEndpoint, refresh]);

    const visibleGifs = useMemo(() => {
        const search = query.trim().toLowerCase();
        return gifs.filter(url => {
            if (brokenUrls[url]) return false;
            return search ? gifName(url).toLowerCase().includes(search) : true;
        });
    }, [brokenUrls, gifs, query]);

    const hasVisibleGifs = visibleGifs.length > 0;

    useLayoutEffect(() => {
        const element = masonryRef.current;
        if (!element) return;

        setMasonryWidth(element.clientWidth);
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setMasonryWidth(entry.contentRect.width);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [loading, error, hasVisibleGifs]);

    const masonryLayout = useMemo(() => {
        if (masonryWidth <= 0) return { items: [] as PositionedGif[], height: 0 };

        const columnCount = Math.min(
            MAX_COLUMNS,
            Math.max(1, Math.floor((masonryWidth + RESULT_GAP) / (RESULT_WIDTH + RESULT_GAP)))
        );
        const columnWidth = Math.max(0, (masonryWidth - (columnCount - 1) * RESULT_GAP) / columnCount);
        const columnHeights = Array.from({ length: columnCount }, () => 0);
        const items: PositionedGif[] = [];

        for (const url of visibleGifs) {
            let shortestColumn = 0;
            for (let index = 1; index < columnCount; index++) {
                if (columnHeights[index] < columnHeights[shortestColumn]) shortestColumn = index;
            }

            const ratio = aspectRatios[url] ?? 1;
            const height = columnWidth / ratio;
            items.push({
                url,
                label: gifName(url),
                left: shortestColumn * (columnWidth + RESULT_GAP),
                top: columnHeights[shortestColumn],
                width: columnWidth,
                height
            });
            columnHeights[shortestColumn] += height + RESULT_GAP;
        }

        const totalHeight = Math.max(0, ...columnHeights) - (items.length > 0 ? RESULT_GAP : 0);
        return { items, height: Math.max(0, totalHeight) };
    }, [aspectRatios, masonryWidth, visibleGifs]);

    const handleSearch = useCallback((value: string) => ExpressionPickerStore.setSearchQuery(value), []);
    const clearSearch = useCallback(() => ExpressionPickerStore.setSearchQuery(""), []);

    const selectGIF = (url: string) => {
        const scrollTop = viewportRef.current?.scrollTop;
        onSelectGIF({ url });
        if (keepPickerOpen) {
            ExpressionPickerStore.openExpressionPicker("catgifs", activeViewType, activeChannelId ?? undefined);
            if (scrollTop !== undefined) {
                const restoreScroll = () => viewportRef.current?.scrollTo({ top: scrollTop });
                restoreScroll();
                requestAnimationFrame(restoreScroll);
                setTimeout(restoreScroll, 50);
            }
        }
    };

    return (
        <div id="catgifs-picker-tab-panel" role="tabpanel" aria-labelledby="catgifs-picker-tab" className={cl("picker")}>
            <div className={cl("picker-header")}>
                <ManaSearchBar
                    autoFocus
                    placeholder="Search CatGIFs"
                    query={query}
                    onChange={handleSearch}
                    onClear={clearSearch}
                />
            </div>

            {loading ? (
                <div className={cl("picker-state")} role="status">
                    Loading GIFs…
                </div>
            ) : error ? (
                <div className={cl("picker-state")} role="alert">
                    <span>{error}</span>
                    <Button variant="secondary" size="small" onClick={() => setRefresh(value => value + 1)}>
                        Try again
                    </Button>
                </div>
            ) : !hasVisibleGifs ? (
                <div className={cl("picker-state")} role="status">
                    {query.trim() ? "No GIFs match your search." : "No GIFs available."}
                </div>
            ) : (
                <div
                    ref={viewportRef}
                    className={classes(
                        cl("masonry-viewport"),
                        ScrollerClasses.scrollbarGutterStable,
                        ScrollerClasses.thin,
                        ScrollerClasses.scrollerBase,
                        ScrollerClasses.fade
                    )}
                >
                    <div
                        ref={masonryRef}
                        className={cl("masonry")}
                        role="region"
                        aria-label="CatGIFs"
                        style={{ height: masonryLayout.height }}
                    >
                        {masonryLayout.items.map(({ url, label, left, top, width, height }) => (
                            <Button
                                key={url}
                                variant="none"
                                size="min"
                                className={cl("item")}
                                style={{ left, top, width, height }}
                                aria-label={`Send ${label}`}
                                title={`Send ${label}`}
                                onMouseDown={e => {
                                    if (e.button === 0) e.preventDefault();
                                }}
                                onClick={e => {
                                    if (e.shiftKey) {
                                        insertTextIntoChatInputBox(`${url} `);
                                        return;
                                    }
                                    selectGIF(url);
                                }}
                                onContextMenu={e =>
                                    ContextMenuApi.openContextMenu(e, () => (
                                        <Menu.Menu navId="catgifs-item" onClose={ContextMenuApi.closeContextMenu} aria-label="CatGIF options">
                                            <Menu.MenuItem
                                                id="catgifs-send-gif"
                                                label="Send GIF"
                                                action={() => selectGIF(url)}
                                            />
                                            <Menu.MenuItem
                                                id="catgifs-insert-chat"
                                                label="Insert Link in Chat"
                                                action={() => {
                                                    insertTextIntoChatInputBox(`${url} `);
                                                    if (!keepPickerOpen) ExpressionPickerStore.closeExpressionPicker();
                                                }}
                                            />
                                            <Menu.MenuItem
                                                id="catgifs-copy-link"
                                                label="Copy GIF Link"
                                                action={() => copyWithToast(url, "GIF link copied to clipboard.")}
                                            />
                                            <Menu.MenuItem
                                                id="catgifs-open-external"
                                                label="Open in Browser"
                                                action={() => void VencordNative.native.openExternal(url)}
                                            />
                                        </Menu.Menu>
                                    ))
                                }
                            >
                                <img
                                    src={url}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    onLoad={({ currentTarget }) => {
                                        if (!currentTarget.naturalWidth || !currentTarget.naturalHeight) return;
                                        const ratio = currentTarget.naturalWidth / currentTarget.naturalHeight;
                                        setAspectRatios(current =>
                                            Math.abs((current[url] ?? 0) - ratio) < 0.001 ? current : { ...current, [url]: ratio }
                                        );
                                    }}
                                    onError={() => {
                                        setBrokenUrls(current => (current[url] ? current : { ...current, [url]: true }));
                                    }}
                                />
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
