// SPDX-License-Identifier: GPL-3.0-or-later

const UPLOAD_TOKEN_KEY = 'catgifs-upload-token';

export function getEndpoint(value: string): URL | null {
  const trimmed = value.trim();
  if (!URL.canParse(trimmed)) return null;

  const url = new URL(trimmed);
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null;
}

export function apiBase(endpointValue: string): URL | null {
  const endpoint = getEndpoint(endpointValue);
  if (!endpoint) return null;

  const host = endpoint.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (endpoint.origin !== 'https://catgifs.marni.cc' && !local) return null;
  return new URL('/', endpoint);
}

export function uploadTokenKey(base: URL): string {
  return `${UPLOAD_TOKEN_KEY}:${base.origin}`;
}

export function normalizeGifUrl(value: unknown, endpoint: URL): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value, endpoint);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/\.gif$/i.test(url.pathname)) return null;
    return new URL(`${url.pathname}${url.search}${url.hash}`, endpoint.origin).href;
  } catch {
    return null;
  }
}
