// SPDX-License-Identifier: GPL-3.0-or-later

import { Button } from '@components/Button';
import { classes } from '@utils/misc';
import { findComponentByCodeLazy, findCssClassesLazy } from '@webpack';
import { ExpressionPickerStore, React } from '@webpack/common';
import type { ComponentType, ReactNode } from 'react';

import { getEndpoint, normalizeGifUrl } from './api';
import { settings } from './ConnectionSettings';

const RESULT_WIDTH = 195;
const RESULT_GAP = 12;
const MAX_COLUMNS = 6;
const ScrollerClasses = findCssClassesLazy('scrollbarGutterStable', 'thin', 'scrollerBase', 'fade');

export interface ExpressionPickerTabProps {
  id?: string;
  'aria-controls'?: string;
  'aria-selected'?: boolean;
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

const ManaSearchBar = findComponentByCodeLazy<ManaSearchBarProps>('.MagnifyingGlassIcon,onClear');

function gifName(url: string) {
  return url
    .slice(url.lastIndexOf('/') + 1)
    .replace(/\.gif$/i, '')
    .replace(/[-_]/g, ' ');
}

export function CatGIFsPicker({ onSelectGIF }: { onSelectGIF: (item: { url: string }) => void }) {
  const { apiEndpoint } = settings.use(['apiEndpoint']);
  const query = ExpressionPickerStore.useExpressionPickerStore((store) => store.searchQuery);
  const [gifs, setGifs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [masonryWidth, setMasonryWidth] = React.useState(0);
  const [aspectRatios, setAspectRatios] = React.useState<Record<string, number>>({});
  const masonryRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const endpoint = getEndpoint(apiEndpoint);
    setLoading(true);

    if (!endpoint) {
      setError('Enter a valid HTTP or HTTPS API base URL in CatGIFs settings.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setError(null);

    fetch(new URL('/api/gifs', endpoint), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The CatGIFs API returned an error.');

        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error('The CatGIFs API did not return a GIF list.');

        setGifs([
          ...new Set(
            payload.map((value) => normalizeGifUrl(value, endpoint)).filter((url): url is string => url !== null),
          ),
        ]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load GIFs from this endpoint.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [apiEndpoint, refresh]);

  const visibleGifs = React.useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? gifs.filter((url) => gifName(url).toLowerCase().includes(search)) : gifs;
  }, [gifs, query]);

  React.useEffect(() => {
    const element = masonryRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setMasonryWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, error, visibleGifs.length]);

  const masonryLayout = React.useMemo(() => {
    const availableWidth = masonryWidth;
    const columnCount = Math.min(
      MAX_COLUMNS,
      Math.max(1, Math.floor((availableWidth + RESULT_GAP) / (RESULT_WIDTH + RESULT_GAP))),
    );
    const columnWidth = Math.max(0, (availableWidth - (columnCount - 1) * RESULT_GAP) / columnCount);
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
        left: shortestColumn * (columnWidth + RESULT_GAP),
        top: columnHeights[shortestColumn],
        width: columnWidth,
        height,
      });
      columnHeights[shortestColumn] += height + RESULT_GAP;
    }

    const totalHeight = Math.max(0, ...columnHeights) - (items.length > 0 ? RESULT_GAP : 0);
    return { items, height: Math.max(0, totalHeight) };
  }, [aspectRatios, masonryWidth, visibleGifs]);

  const handleSearch = React.useCallback((value: string) => ExpressionPickerStore.setSearchQuery(value), []);
  const clearSearch = React.useCallback(() => ExpressionPickerStore.setSearchQuery(''), []);

  return (
    <div id="catgifs-picker-tab-panel" role="tabpanel" aria-labelledby="catgifs-picker-tab" className="catgifs-picker">
      <div className="catgifs-picker-header">
        <ManaSearchBar
          autoFocus
          placeholder="Search CatGIFs"
          query={query}
          onChange={handleSearch}
          onClear={clearSearch}
        />
      </div>

      {loading ? (
        <div className="catgifs-picker-state" role="status">
          Loading GIFs…
        </div>
      ) : error ? (
        <div className="catgifs-picker-state" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="small" onClick={() => setRefresh((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : visibleGifs.length === 0 ? (
        <div className="catgifs-picker-state" role="status">
          {query.trim() ? 'No GIFs match your search.' : 'No GIFs available.'}
        </div>
      ) : (
        <div
          className={classes(
            'catgifs-masonry-viewport',
            ScrollerClasses.scrollbarGutterStable,
            ScrollerClasses.thin,
            ScrollerClasses.scrollerBase,
            ScrollerClasses.fade,
          )}
        >
          <div
            ref={masonryRef}
            className="catgifs-masonry"
            role="region"
            aria-label="CatGIFs"
            style={{ height: masonryLayout.height }}
          >
            {masonryLayout.items.map(({ url, left, top, width, height }) => (
              <Button
                key={url}
                variant="none"
                size="min"
                className="catgifs-item"
                style={{ left, top, width, height }}
                aria-label={`Send ${gifName(url)}`}
                title={`Send ${gifName(url)}`}
                onClick={() => onSelectGIF({ url })}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onLoad={({ currentTarget }) => {
                    if (!currentTarget.naturalWidth || !currentTarget.naturalHeight) return;
                    const ratio = currentTarget.naturalWidth / currentTarget.naturalHeight;
                    setAspectRatios((current) =>
                      Math.abs((current[url] ?? 0) - ratio) < 0.001 ? current : { ...current, [url]: ratio },
                    );
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
