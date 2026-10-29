/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT = 30_000;

interface ExtensionMediaResult {
  success: boolean;
  data?: string;
  contentType?: string;
  fileName?: string;
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExtensionMediaResult(value: unknown): value is ExtensionMediaResult {
  return isObject(value) && typeof value.success === 'boolean';
}

function downloadExtensionMedia(source: URL) {
  return new Promise<
    | { success: true; bytes: Uint8Array; contentType: string; fileName: string }
    | { success: false; error: string }
  >((resolve) => {
    const id = crypto.randomUUID();
    const finish = (result: ExtensionMediaResult) => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      if (!result.success || !result.data || !result.contentType || !result.fileName) {
        resolve({ success: false, error: result.error || 'The browser extension could not download this image.' });
        return;
      }

      try {
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        resolve({ success: true, bytes, contentType: result.contentType, fileName: result.fileName });
      } catch {
        resolve({ success: false, error: 'The browser extension returned invalid image data.' });
      }
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin || !isObject(event.data)) return;
      if (
        event.data.type !== 'catgifs:download-result' ||
        event.data.id !== id ||
        !isExtensionMediaResult(event.data.result)
      )
        return;
      finish(event.data.result);
    };
    const timeout = setTimeout(
      () => finish({ success: false, error: 'The browser extension timed out while downloading this image.' }),
      REQUEST_TIMEOUT + 5_000,
    );
    window.addEventListener('message', handleMessage);
    window.postMessage({ type: 'catgifs:download', id, url: source.href }, window.location.origin);
  });
}

function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4?.every(part => part <= 255)) {
    const [a, b, c] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  if (!host.includes(':')) return false;
  const first = Number.parseInt(host.split(':')[0] || '0', 16);
  return (
    host === '::' ||
    host === '::1' ||
    host.startsWith('::ffff:') ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    host.startsWith('2001:db8:')
  );
}

export async function downloadWebMedia(source: URL) {
  if (IS_EXTENSION) return downloadExtensionMedia(source);

  try {
    if (isPrivateHost(source.hostname)) throw new Error('Private network media links cannot be uploaded.');

    const response = await fetch(source, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) throw new Error(`The media host returned HTTP ${response.status}.`);

    const contentType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error('The media host did not return an image.');
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
      await response.body?.cancel();
      throw new Error('This file is over the 24 MiB upload limit.');
    }
    let bytes: Uint8Array;
    if (response.body) {
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

      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_MEDIA_BYTES) throw new Error('This file is over the 24 MiB upload limit.');
      bytes = new Uint8Array(buffer);
    }

    const encodedName = source.pathname.split('/').pop() || 'discord-gif.gif';
    let fileName: string;
    try {
      fileName = decodeURIComponent(encodedName);
    } catch {
      fileName = encodedName;
    }
    return { success: true as const, bytes, contentType, fileName };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error && error.name !== 'TypeError'
          ? error.message
          : 'The browser could not download this image. The image host may block cross-origin requests.',
    };
  }
}
