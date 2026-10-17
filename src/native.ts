// SPDX-License-Identifier: GPL-3.0-or-later

import { CspPolicies, ImageSrc } from '@main/csp';
import { RendererSettings } from '@main/settings';
import type { IpcMainInvokeEvent } from 'electron';

const DEFAULT_ENDPOINT = 'https://catgifs.marni.cc';
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT = 30_000;
const apiEndpoint = RendererSettings.store.plugins?.CatGIFs?.apiEndpoint ?? DEFAULT_ENDPOINT;

CspPolicies['catgifs.marni.cc'] = ImageSrc;
if (URL.canParse(apiEndpoint)) {
  const { host, protocol } = new URL(apiEndpoint);
  if (protocol === 'https:' || protocol === 'http:') CspPolicies[host] = ImageSrc;
}

function parseMediaUrl(value: string): URL {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error('This image URL is not supported.');
  }

  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('Only HTTP or HTTPS media links can be uploaded.');
  }
  return url;
}

async function fetchMedia(url: URL): Promise<{ response: Response; url: URL }> {
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (response.status < 300 || response.status >= 400) return { response, url };

    const location = response.headers.get('location');
    if (!location || redirects === MAX_REDIRECTS) {
      throw new Error('The media host redirected too many times.');
    }

    await response.body?.cancel();
    url = parseMediaUrl(new URL(location, url).href);
  }

  throw new Error('The media host redirected too many times.');
}

async function readMedia(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
    await response.body?.cancel();
    throw new Error('This file is over the 24 MiB upload limit.');
  }
  if (!response.body) throw new Error('The media host returned an empty response.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error('This file is over the 24 MiB upload limit.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function getFileName(url: URL): string {
  const encodedName = url.pathname.split('/').pop() || 'discord-gif.gif';
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

export async function downloadGifMedia(_: IpcMainInvokeEvent, source: string) {
  const sourceUrl = parseMediaUrl(source);
  const media = await fetchMedia(sourceUrl);
  const { response, url } = media;
  if (response.status === 404 || response.status === 410) {
    throw new Error('The selected media URL is unavailable (HTTP 404/410).');
  }
  if (!response.ok) throw new Error(`The media host returned HTTP ${response.status}.`);

  return {
    bytes: await readMedia(response),
    contentType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
    fileName: getFileName(url),
  };
}
