// SPDX-License-Identifier: GPL-3.0-or-later

import type { NavContextMenuPatchCallback } from '@api/ContextMenu';
import * as DataStore from '@api/DataStore';
import ErrorBoundary from '@components/ErrorBoundary';
import definePlugin, { PluginNative } from '@utils/types';
import { Menu, showToast } from '@webpack/common';
import type { ComponentType } from 'react';

import { apiBase, uploadTokenKey } from './api';
import { ConnectionSettings, settings } from './ConnectionSettings';
import { CatGIFsPicker, type ExpressionPickerTabProps } from './GifPicker';
import managedStyle from './styles.css?managed';

const CATGIFS_VIEW = 'catgifs';
const Native = VencordNative.pluginHelpers.CatGIFs as PluginNative<typeof import('./native')> | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function uploadGif(urlValue: string) {
  try {
    const base = apiBase(settings.store.apiEndpoint);
    if (!base) {
      showToast('Set API Base URL to catgifs.marni.cc or a localhost address first.', 'failure');
      return;
    }
    const token = await DataStore.get<string>(uploadTokenKey(base));
    if (!token) {
      showToast('Connect CatGIFs in Equicord plugin settings first.', 'failure');
      return;
    }
    const source = new URL(urlValue);
    if (source.protocol !== 'https:' && source.protocol !== 'http:')
      throw new Error('This image URL is not supported.');
    if (/\.gif$/i.test(source.pathname) && source.searchParams.get('format') === 'webp') {
      source.searchParams.set('format', 'gif');
    }
    if (!Native?.downloadGifMedia) {
      throw new Error(
        'This Equicord process has no CatGIFs native helper loaded. Fully quit and launch the freshly built Equibop client.',
      );
    }
    const media = await Native.downloadGifMedia(source.href);
    let fileName = media.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'discord-gif.gif';
    if (!/\.gif$/i.test(fileName) && media.contentType === 'image/gif') {
      fileName += '.gif';
    }
    const form = new FormData();
    form.append('file', new File([new Uint8Array(media.bytes)], fileName, { type: media.contentType }));
    const response = await fetch(new URL('/api/equicord/uploads', base), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      credentials: 'omit',
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const result: Record<string, unknown> = isObject(payload) ? payload : {};
    if (!response.ok) {
      console.error('[CatGIFs] Upload API rejected the downloaded media', {
        status: response.status,
        error: result.error,
        fileName,
        bytes: media.bytes.byteLength,
        contentType: media.contentType,
      });
      if (response.status === 401) {
        await DataStore.del(uploadTokenKey(base));
        notifyUpload('CatGIFs connection expired or was revoked. Reconnect in plugin settings.', 'failure');
      } else {
        notifyUpload(typeof result.error === 'string' ? result.error : 'CatGIFs could not accept this GIF.', 'failure');
      }
      return;
    }
    notifyUpload('GIF submitted to CatGIFs for review!', 'success');
  } catch (error) {
    console.error('[CatGIFs] GIF upload failed:', error);
    notifyUpload(error instanceof Error ? error.message : 'Could not upload this GIF.', 'failure');
  }
}

function notifyUpload(message: string, type: 'success' | 'failure') {
  try {
    showToast(message, type);
  } catch (error) {
    console.error('[CatGIFs] Could not show upload notification:', error);
  }
}

function getMediaSource(props: Record<string, unknown> | undefined): string | null {
  if (!props) return null;

  // Direct url / src properties (used in gif-picker, image-context, etc.)
  for (const key of ['src', 'itemSrc', 'itemHref', 'url', 'href']) {
    const val = props[key];
    if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
      return val;
    }
  }

  // Direct attachment (message context on attachment)
  const attachment = props.attachment as { proxy_url?: string; url?: string } | undefined;
  if (attachment) {
    const url = attachment.proxy_url || attachment.url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }

  // Target element (e.g. clicked <img> or <video> tag)
  const target = props.target as {
    classList?: { contains: (cls: string) => boolean };
    src?: unknown;
    closest?: (selector: string) => { src?: unknown; currentSrc?: unknown } | null;
    querySelector?: (selector: string) => { src?: unknown; currentSrc?: unknown } | null;
  } | undefined;

  if (target?.classList?.contains('emoji')) return null;

  if (typeof target?.src === 'string' && /^https?:\/\//i.test(target.src)) {
    return target.src;
  }

  const mediaEl = target?.closest?.('img, video') || target?.querySelector?.('img, video');
  const mediaSrc = mediaEl?.currentSrc || mediaEl?.src;
  if (typeof mediaSrc === 'string' && /^https?:\/\//i.test(mediaSrc)) {
    return mediaSrc;
  }

  // Message attachments & embeds (when right-clicking a message)
  const message = props.message as {
    attachments?: Array<{ proxy_url?: string; url?: string; content_type?: string }>;
    embeds?: Array<{
      video?: { proxyURL?: string; url?: string };
      image?: { proxyURL?: string; url?: string };
      thumbnail?: { proxyURL?: string; url?: string };
    }>;
  } | undefined;

  if (message) {
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      const gifAttachment = message.attachments.find(a =>
        a.content_type?.includes('gif') || /\.gif([?#]|$)/i.test(a.url || '') || /\.gif([?#]|$)/i.test(a.proxy_url || '')
      ) ?? message.attachments[0];

      const url = gifAttachment?.proxy_url || gifAttachment?.url;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
    }

    if (Array.isArray(message.embeds)) {
      for (const embed of message.embeds) {
        const img = embed.image || embed.thumbnail;
        const video = embed.video;
        const url = img?.proxyURL || img?.url || video?.proxyURL || video?.url;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
      }
    }
  }

  return null;
}

const uploadContextMenuPatch: NavContextMenuPatchCallback = (children, props?: Record<string, unknown>) => {
  const source = getMediaSource(props);
  if (!source) return;

  if (children.some(child => child?.props?.id === 'catgifs-upload-gif')) return;

  children.push(
    <Menu.MenuItem
      id="catgifs-upload-gif"
      key="catgifs-upload-gif"
      label="Upload to CatGIFs"
      action={() => void uploadGif(source)}
    />,
  );
};

const SafeCatGIFsPicker = ErrorBoundary.wrap(CatGIFsPicker, { noop: true });

export default definePlugin({
  name: 'CatGIFs',
  description: 'Add GIFs from a custom endpoint to the expression picker.',
  authors: [{ name: 'marni_', id: 282905846457827330n }],
  tags: ['Chat', 'Media'],
  enabledByDefault: true,
  settings,
  managedStyle,
  contextMenus: {
    'gif-picker': uploadContextMenuPatch,
    'image-context': uploadContextMenuPatch,
    'message': uploadContextMenuPatch,
    'attachment-link-context': uploadContextMenuPatch,
  },

  patches: [
    {
      find: '#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}',
      replacement: [
        {
          match: /(children:\[[^[\]]{0,80},)(?=\i&&\i&&\(0,\i\.jsx\)\((\i),\{id:\i\.\i,"aria-controls":\i\.\i,"aria-selected":(\i)===\i\.\i\.SOUNDBOARD)/,
          replace: '$1$self.renderCatTab($2,$3),',
        },
        {
          match: /(\i)===\i\.\i\.GIF&&\i\?\(0,\i\.jsx\)\(\i(?:\.\i)?,\{onSelectGIF:(\i),hideFavorites:\i,persistSearch:!0\}\):null,/,
          replace: '$&$1==="catgifs"?$self.renderCatGIFsPicker($2):null,',
        },
      ],
    },
  ],

  renderCatTab(Tab: ComponentType<ExpressionPickerTabProps>, activeView: string) {
    return (
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
    );
  },

  renderCatGIFsPicker(onSelectGIF: (item: { url: string }) => void) {
    return <SafeCatGIFsPicker onSelectGIF={onSelectGIF} />;
  },
});
