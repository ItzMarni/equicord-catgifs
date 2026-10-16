// SPDX-License-Identifier: GPL-3.0-or-later

import type { NavContextMenuPatchCallback } from '@api/ContextMenu';
import * as DataStore from '@api/DataStore';
import { getIntlMessage } from '@utils/discord';
import definePlugin, { PluginNative } from '@utils/types';
import { Menu, React, showToast } from '@webpack/common';
import type { ComponentType, ReactNode } from 'react';

import { apiBase, uploadTokenKey } from './api';
import type { ExpressionPickerTabProps } from './GifPicker';
import { ConnectionSettings, settings } from './ConnectionSettings';
import { CatGIFsPicker } from './GifPicker';
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
    const fileName = media.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'discord-gif.gif';
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

const gifPickerContextMenu: NavContextMenuPatchCallback = (children, props: { src?: unknown; url?: unknown }) => {
  const source = typeof props?.src === 'string' ? props.src : props?.url;
  if (typeof source !== 'string' || !/^https?:\/\//i.test(source)) return;
  children.push(
    <Menu.MenuItem
      id="catgifs-upload-gif"
      key="catgifs-upload-gif"
      label="Upload to CatGIFs"
      action={() => void uploadGif(source)}
    />,
  );
};

export default definePlugin({
  name: 'CatGIFs',
  description: 'Add GIFs from a custom endpoint to the expression picker.',
  authors: [{ name: 'marni_', id: 282905846457827330n }],
  tags: ['Chat', 'Media'],
  enabledByDefault: true,
  settings,
  managedStyle,
  contextMenus: {
    'gif-picker': gifPickerContextMenu,
  },

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
