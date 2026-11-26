// SPDX-License-Identifier: GPL-3.0-or-later

import type { NavContextMenuPatchCallback } from '@api/ContextMenu';
import * as DataStore from '@api/DataStore';
import ErrorBoundary from '@components/ErrorBoundary';
import { Logger } from '@utils/Logger';
import definePlugin, { PluginNative, ReporterTestable } from '@utils/types';
import * as WebpackCommon from '@webpack/common';
import { Menu, showToast } from '@webpack/common';
import type { ComponentType } from 'react';

import { apiBase, uploadTokenKey } from './api';
import { settings } from './ConnectionSettings';
import { CatGIFsPicker, type ExpressionPickerTabProps } from './GifPicker';
import managedStyle from './styles.css?managed';
import { downloadWebMedia } from './web';

const CATGIFS_VIEW = 'catgifs';
const Native = VencordNative.pluginHelpers.CatGIFs as PluginNative<typeof import('./native')> | undefined;
const logger = new Logger('CatGIFs');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ModernToastOptions {
  text: string;
  variant: 'success' | 'critical';
}

type CrossClientShowToast =
  | ((message: string, type: 'success' | 'failure') => void)
  | ((options: ModernToastOptions) => void);

const crossClientShowToast: CrossClientShowToast = showToast;

async function uploadGif(urlValue: string) {
  try {
    const base = apiBase(settings.store.apiEndpoint);
    if (!base) {
      notifyUpload('Set API Base URL to catgifs.marni.cc or a localhost address first.', 'failure');
      return;
    }
    const token = await DataStore.get<string>(uploadTokenKey(base));
    if (!token) {
      notifyUpload('Connect CatGIFs in plugin settings first.', 'failure');
      return;
    }
    const source = new URL(urlValue);
    if ((source.protocol !== 'https:' && source.protocol !== 'http:') || source.username || source.password)
      throw new Error('This image URL is not supported.');
    if (/\.gif$/i.test(source.pathname) && source.searchParams.get('format') === 'webp') {
      source.searchParams.set('format', 'gif');
    }
    const media = Native?.downloadGifMedia
      ? await Native.downloadGifMedia(source.href)
      : IS_WEB
        ? await downloadWebMedia(source)
        : { success: false as const, error: 'This client has no CatGIFs media downloader.' };
    if (!media.success) throw new Error(media.error);
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
      logger.error('Upload API rejected the downloaded media', {
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
    notifyUpload('GIF submitted to CatGIFs for review.', 'success');
  } catch (error) {
    logger.error('GIF upload failed:', error);
    notifyUpload(error instanceof Error ? error.message : 'Could not upload this GIF.', 'failure');
  }
}

function notifyUpload(message: string, type: 'success' | 'failure') {
  try {
    if ('Toasts' in WebpackCommon) {
      (crossClientShowToast as (message: string, type: 'success' | 'failure') => void)(message, type);
    } else {
      (crossClientShowToast as (options: ModernToastOptions) => void)({
        text: message,
        variant: type === 'success' ? 'success' : 'critical',
      });
    }
  } catch (error) {
    logger.error('Could not show upload notification:', error);
  }
}

function getMediaSource(props: Record<string, unknown> | undefined): string | null {
  if (!props) return null;

  // Provider share pages are HTML and may reject downloads with HTTP 403.
  // Use the actual media from the picker, clicked element, or message embed.
  const mediaUrl = (value: unknown): string | null => {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
    try {
      const url = new URL(value);
      if (/^(?:www\.)?(?:klipy|tenor|giphy)\.com$/i.test(url.hostname)) return null;
      return url.href;
    } catch {
      return null;
    }
  };

  const pickerItems = [props, props.gif, props.item].filter(isObject);
  for (const item of pickerItems) {
    for (const key of ['gif_src', 'gifSrc', 'src', 'itemSrc', 'itemHref', 'url', 'href', 'link']) {
      const url = mediaUrl(item[key]);
      if (url) return url;
    }
  }

  const target = props.target instanceof Element ? props.target : null;
  const mediaElement = target?.closest('img, video') ?? target?.querySelector('img, video');
  if (mediaElement instanceof HTMLImageElement || mediaElement instanceof HTMLVideoElement) {
    const url = mediaUrl(mediaElement.currentSrc || mediaElement.src);
    if (url) return url;
  }

  const attachment = props.attachment as { proxy_url?: string; url?: string } | undefined;
  if (attachment) {
    const url = mediaUrl(attachment.proxy_url) || mediaUrl(attachment.url);
    if (url) return url;
  }

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

      const url = mediaUrl(gifAttachment?.proxy_url) || mediaUrl(gifAttachment?.url);
      if (url) return url;
    }

    if (Array.isArray(message.embeds)) {
      for (const embed of message.embeds) {
        const img = embed.image || embed.thumbnail;
        const video = embed.video;
        const url = mediaUrl(img?.proxyURL) || mediaUrl(img?.url) || mediaUrl(video?.proxyURL) || mediaUrl(video?.url);
        if (url) return url;
      }
    }
  }

  return null;
}

const uploadContextMenuPatch: NavContextMenuPatchCallback = (children, props?: Record<string, unknown>) => {
  if (!Native?.downloadGifMedia && !IS_WEB) return;
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
  reporterTestable: ReporterTestable.Patches,
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
      group: true,
      replacement: [
        {
          match:
            /(children:\[[^[\]]{0,80},)(?=\i&&\i&&\(0,\i\.jsx\)\((\i),\{id:\i\.\i,"aria-controls":\i\.\i,"aria-selected":(\i)===\i\.\i\.SOUNDBOARD)/,
          replace: '$1$self.renderCatTab($2,$3),',
        },
        {
          match:
            /(\i)===\i\.\i\.GIF&&\i\?\(0,\i\.jsx\)\(\i(?:\.\i)?,\{(?=[^}]{0,150}onSelectGIF:(\i))[^}]{0,150}\}\):null,/,
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
