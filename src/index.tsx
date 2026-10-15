// SPDX-License-Identifier: GPL-3.0-or-later

import { definePluginSettings } from '@api/Settings';
import { Button } from '@components/Button';
import { getIntlMessage } from '@utils/discord';
import { findComponentByCodeLazy } from '@webpack';
import definePlugin, { OptionType } from '@utils/types';
import { ExpressionPickerStore, React } from '@webpack/common';
import type { ComponentType, ReactNode } from 'react';

import managedStyle from './styles.css?managed';

const DEFAULT_ENDPOINT = 'https://catgifs.marni.cc/api/gifs';
const CATGIFS_VIEW = 'catgifs';

const settings = definePluginSettings({
  apiEndpoint: {
    type: OptionType.STRING,
    displayName: 'API Endpoint',
    description:
      'Full URL returning a JSON array of GIF URLs. Serve GIFs from the same host and restart Equibop after changing this.',
    default: DEFAULT_ENDPOINT,
    restartNeeded: true,
  },
});

interface ExpressionPickerTabProps {
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

function getEndpoint(value: string): URL | null {
  if (!URL.canParse(value)) return null;

  const url = new URL(value);
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

function normalizeGifUrl(value: unknown, endpoint: URL): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value, endpoint);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/\.gif$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function gifName(url: string) {
  return url
    .slice(url.lastIndexOf('/') + 1)
    .replace(/\.gif$/i, '')
    .replace(/[-_]/g, ' ');
}

function CatGIFsPicker({ onSelectGIF }: { onSelectGIF: (item: { url: string }) => void }) {
  const { apiEndpoint } = settings.use(['apiEndpoint']);
  const query = ExpressionPickerStore.useExpressionPickerStore((store) => store.searchQuery);
  const [gifs, setGifs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    const endpoint = getEndpoint(apiEndpoint.trim());
    setLoading(true);

    if (!endpoint) {
      setError('Enter a valid HTTP or HTTPS API endpoint in CatGIFs settings.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setError(null);

    fetch(endpoint.href, { signal: controller.signal })
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
        <div className="catgifs-masonry-viewport">
          <div className="catgifs-masonry" role="region" aria-label="CatGIFs">
            {visibleGifs.map((url) => (
              <Button
                key={url}
                variant="none"
                size="min"
                className="catgifs-item"
                aria-label={`Send ${gifName(url)}`}
                title={`Send ${gifName(url)}`}
                onClick={() => onSelectGIF({ url })}
              >
                <img src={url} alt={gifName(url)} loading="lazy" decoding="async" />
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default definePlugin({
  name: 'CatGIFs',
  description: 'Add GIFs from a custom endpoint to the expression picker.',
  authors: [{ name: 'marni_', id: 282905846457827330n }],
  tags: ['Chat', 'Media'],
  enabledByDefault: true,
  settings,
  managedStyle,

  patches: [
    {
      find: '#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}',
      replacement: [
        {
          match:
            /\(0,\i\.jsx\)\((\i),[^}]{20,40}?"aria-selected":(\i)[^}]{50,100}?#{intl::EXPRESSION_PICKER_GIF}\)\}\)/,
          replace: '$self.renderTabs($1,$2)',
        },
        {
          match: /\{onSelectGIF:(\i),[^}]{20,40}\}\):null,(?=(\i)===)/,
          replace: '$&$self.renderCatGIFsPicker($2,$1),',
        },
      ],
    },
  ],

  renderTabs(Tab: ComponentType<ExpressionPickerTabProps>, activeView: string) {
    return (
      <>
        <Tab
          id="gif-picker-tab"
          key="gif-picker-tab"
          aria-controls="gif-picker-tab-panel"
          aria-selected={activeView === 'gif'}
          isActive={activeView === 'gif'}
          viewType="gif"
        >
          {getIntlMessage('EXPRESSION_PICKER_GIF')}
        </Tab>
        <Tab
          id="catgifs-picker-tab"
          key="catgifs-picker-tab"
          aria-controls="catgifs-picker-tab-panel"
          aria-selected={activeView === CATGIFS_VIEW}
          isActive={activeView === CATGIFS_VIEW}
          viewType={CATGIFS_VIEW}
        >
          CatGIFs
        </Tab>
      </>
    );
  },

  renderCatGIFsPicker(activeView: string, onSelectGIF: (item: { url: string }) => void) {
    return activeView === CATGIFS_VIEW ? <CatGIFsPicker onSelectGIF={onSelectGIF} /> : null;
  },
});
