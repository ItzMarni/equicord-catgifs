// SPDX-License-Identifier: GPL-3.0-or-later

import { CspPolicies, ImageSrc } from '@main/csp';
import { RendererSettings } from '@main/settings';
import type { IpcMainInvokeEvent } from 'electron';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { apiBase } from './api';

const DEFAULT_ENDPOINT = 'https://catgifs.marni.cc';
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT = 30_000;
const apiEndpoint = RendererSettings.store.plugins?.CatGIFs?.apiEndpoint ?? DEFAULT_ENDPOINT;
const endpoint = apiBase(apiEndpoint) ?? new URL(DEFAULT_ENDPOINT);
const blockedAddresses = new BlockList();

CspPolicies['catgifs.marni.cc'] = ImageSrc;
CspPolicies[endpoint.host] = ImageSrc;

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

class MediaDownloadError extends Error {}

function parseMediaUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new MediaDownloadError('This image URL is not supported.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MediaDownloadError('This image URL is not supported.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new MediaDownloadError('Only HTTP or HTTPS media links can be uploaded.');
  }
  return url;
}

async function assertPublicUrl(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new MediaDownloadError('Private network media links cannot be uploaded.');
  }

  const family = isIP(hostname);
  if (family) {
    if (blockedAddresses.check(hostname, family === 4 ? 'ipv4' : 'ipv6')) {
      throw new MediaDownloadError('Private network media links cannot be uploaded.');
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new MediaDownloadError('The media host could not be resolved.');
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6'))
  ) {
    throw new MediaDownloadError('Private network media links cannot be uploaded.');
  }
}

async function fetchMedia(url: URL): Promise<{ response: Response; url: URL }> {
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (response.status < 300 || response.status >= 400) return { response, url };

    const location = response.headers.get('location');
    if (!location || redirects === MAX_REDIRECTS) {
      throw new MediaDownloadError('The media host redirected too many times.');
    }

    await response.body?.cancel();
    url = parseMediaUrl(new URL(location, url).href);
  }

  throw new MediaDownloadError('The media host redirected too many times.');
}

async function readMedia(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
    await response.body?.cancel();
    throw new MediaDownloadError('This file is over the 24 MiB upload limit.');
  }
  if (!response.body) throw new MediaDownloadError('The media host returned an empty response.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new MediaDownloadError('This file is over the 24 MiB upload limit.');
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

export async function downloadGifMedia(_: IpcMainInvokeEvent, source: unknown) {
  try {
    const sourceUrl = parseMediaUrl(source);
    const { response, url } = await fetchMedia(sourceUrl);
    if (response.status === 404 || response.status === 410) {
      throw new MediaDownloadError('The selected media URL is unavailable (HTTP 404/410).');
    }
    if (!response.ok) throw new MediaDownloadError(`The media host returned HTTP ${response.status}.`);

    const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      await response.body?.cancel();
      throw new MediaDownloadError('The image host did not return an image.');
    }
    return {
      success: true as const,
      bytes: await readMedia(response),
      contentType,
      fileName: getFileName(url),
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof MediaDownloadError ? error.message : 'Could not download this image.',
    };
  }
}
