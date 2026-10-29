// SPDX-License-Identifier: GPL-3.0-or-later

import * as DataStore from '@api/DataStore';
import { definePluginSettings } from '@api/Settings';
import { Button } from '@components/Button';
import { sleep } from '@utils/misc';
import { OptionType } from '@utils/types';
import { React } from '@webpack/common';

import { apiBase, uploadTokenKey } from './api';

const DEFAULT_ENDPOINT = 'https://catgifs.marni.cc';
const API_ENDPOINT_SETTING = ['apiEndpoint'] satisfies ('apiEndpoint')[];

export const settings = definePluginSettings({
  keepPickerOpen: {
    type: OptionType.BOOLEAN,
    description: 'Keep the CatGIFs picker open after sending a GIF.',
    default: false,
  },
  apiEndpoint: {
    type: OptionType.STRING,
    displayName: 'API Base URL',
    description:
      'CatGIFs server URL, such as https://catgifs.marni.cc or http://localhost:8080. Restart the client after changing this.',
    default: DEFAULT_ENDPOINT,
    restartNeeded: true,
  },
  connection: {
    type: OptionType.COMPONENT,
    component: ConnectionSettings,
  },
});

interface DeviceGrant {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readDeviceGrant(value: unknown): DeviceGrant | null {
  if (
    !isObject(value) ||
    typeof value.device_code !== 'string' ||
    typeof value.user_code !== 'string' ||
    typeof value.verification_uri_complete !== 'string' ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    typeof value.interval !== 'number' ||
    !Number.isFinite(value.interval) ||
    value.interval < 0
  )
    return null;
  return {
    device_code: value.device_code,
    user_code: value.user_code,
    verification_uri_complete: value.verification_uri_complete,
    expires_in: value.expires_in,
    interval: value.interval,
  };
}

export function ConnectionSettings() {
  const { apiEndpoint } = settings.use(API_ENDPOINT_SETTING);
  const base = apiBase(apiEndpoint);
  const tokenKey = base ? uploadTokenKey(base) : null;
  const [connected, setConnected] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const connectionAbort = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => connectionAbort.current?.abort(), []);

  React.useEffect(() => {
    setConnected(false);
    if (!tokenKey) return;
    void DataStore.get<string>(tokenKey)
      .then((token) => setConnected(Boolean(token)))
      .catch(() => setMessage('Could not read the local CatGIFs connection.'));
  }, [tokenKey]);

  const connect = async () => {
    if (!base) {
      setMessage('Set API Base URL to catgifs.marni.cc or a localhost address before connecting.');
      return;
    }

    setBusy(true);
    setMessage('Starting secure connection…');
    connectionAbort.current?.abort();
    const controller = new AbortController();
    connectionAbort.current = controller;
    try {
      const start = await fetch(new URL('/api/equicord/device', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: 'Discord client' }),
        signal: controller.signal,
      });
      if (!start.ok) {
        throw new Error(
          start.status === 429
            ? 'Too many connection attempts. Try again in a minute.'
            : 'Could not start the CatGIFs connection.',
        );
      }
      const grant = readDeviceGrant(await start.json());
      if (!grant) throw new Error('CatGIFs returned an invalid connection response.');
      const verificationUrl = new URL(grant.verification_uri_complete);
      if (verificationUrl.origin !== base.origin) throw new Error('CatGIFs returned an invalid approval URL.');
      setMessage(`Enter ${grant.user_code} in the browser window to approve this device.`);
      VencordNative.native.openExternal(verificationUrl.href);

      const expiresAt = Date.now() + grant.expires_in * 1000;
      let interval = Math.max(5, grant.interval) * 1000;
      while (Date.now() < expiresAt) {
        await sleep(interval);
        if (controller.signal.aborted) return;
        const response = await fetch(new URL('/api/equicord/token', base), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: grant.device_code }),
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        const result: Record<string, unknown> = isObject(payload) ? payload : {};
        if (result.status === 'authorized' && typeof result.access_token === 'string') {
          await DataStore.set(uploadTokenKey(base), result.access_token);
          setMessage('Connected. Right-click a GIF in Discord to submit it for review.');
          setConnected(true);
          return;
        }
        if (result.status === 'authorization_pending') continue;
        if (response.status === 429) {
          interval = Math.max(interval + 5000, 10000);
          continue;
        }
        if (result.status === 'expired') throw new Error('That connection code expired. Start again to get a new one.');
        if (result.status === 'access_denied')
          throw new Error('CatGIFs denied this connection, or the account is inactive.');
        if (result.status === 'device_limit_reached')
          throw new Error('This account has reached its connected device limit.');
        throw new Error(typeof result.error === 'string' ? result.error : 'Could not finish connecting to CatGIFs.');
      }
      throw new Error('That connection code expired. Start again to get a new one.');
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : 'Could not connect to CatGIFs.');
    } finally {
      if (connectionAbort.current === controller) {
        connectionAbort.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };

  const disconnect = async () => {
    if (!tokenKey) return;
    try {
      await DataStore.del(tokenKey);
      setConnected(false);
      setMessage('Disconnected.');
    } catch {
      setMessage('Could not remove the local CatGIFs token.');
    }
  };

  return (
    <div className="catgifs-connection-setting">
      <p>
        {connected
          ? 'This client is connected to CatGIFs.'
          : 'Connect this client to upload GIFs from Discord. Approve it in the browser; no API key is shown or pasted.'}
      </p>
      <div className="catgifs-connection-actions">
        {connected ? (
          <>
            <Button
              variant="primary"
              size="small"
              disabled={!base}
              onClick={() => {
                if (base) VencordNative.native.openExternal(new URL('/settings/equicord', base).href);
              }}
            >
              Manage connected devices
            </Button>
            <Button variant="secondary" size="small" onClick={disconnect}>
              Remove local token
            </Button>
          </>
        ) : (
          <Button variant="primary" size="small" disabled={busy} onClick={connect}>
            {busy ? 'Waiting for approval…' : 'Connect to CatGIFs'}
          </Button>
        )}
      </div>
      {connected && (
        <p>
          To revoke this credential, disconnect this device on the CatGIFs settings page. Removing the local token only
          disconnects this client.
        </p>
      )}
      {message && (
        <p role="status" className="catgifs-connection-message">
          {message}
        </p>
      )}
    </div>
  );
}
