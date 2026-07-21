import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel } from '../../core/hardware/print/zpl';
import type { ScanEvent } from '../../core/hardware/scan/ScanProvider';
import {
  loginWithLoopback,
  refreshTokens,
  discoverEndpoints,
} from '../../core/auth/login';
import { createStrongholdTokenStore } from '../../core/auth/tokenStore';
import { createTokenManager } from '../../core/auth/tokenManager';
import { createApiClient } from '../../core/data/httpClient';
import { oidcConfig } from '../../app/config';

export function DiagnosticsScreen() {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState('');
  const emit = useScanEmit();
  useScanner((e) => setScans((s) => [e, ...s].slice(0, 20)));

  async function onLogin() {
    setStatus('logging in…');
    try {
      const store = createStrongholdTokenStore(setStatus);
      const manager = createTokenManager({
        store,
        refresh: async (refreshToken) => {
          const eps = await discoverEndpoints();
          return refreshTokens({ tokenEndpoint: eps.token_endpoint, refreshToken });
        },
      });
      await loginWithLoopback({ manager, onStep: setStatus });
      const client = createApiClient({
        baseUrl: oidcConfig.issuer,
        getToken: () => manager.getAccessToken(),
        authMode: 'bearer',
      });
      setStatus('7/7 fetching userinfo…');
      const info = await client.request<{ sub?: string; email?: string }>({
        path: '/oauth/userinfo',
      });
      setStatus(`logged in: sub=${info.sub ?? '?'} email=${info.email ?? '?'}`);
    } catch (e) {
      setStatus(`login error: ${String(e)}`);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Diagnostics</h1>

      <section>
        <h2 className="font-medium">Scans (HID + camera)</h2>
        <ul className="mt-1 max-h-40 overflow-auto text-sm">
          {scans.map((s, i) => (
            <li key={i}>
              [{s.source}] {s.code}
            </li>
          ))}
        </ul>
        <Button
          className="mt-2"
          onClick={() =>
            scanWithCamera(emit).catch((e) => setStatus(String(e)))
          }
        >
          Camera scan
        </Button>
      </section>

      <section>
        <h2 className="font-medium">Printer</h2>
        <Button
          onClick={async () => {
            const zpl = renderTestLabel({
              title: 'ALMOND WMS',
              barcode: '8801234',
            });
            const target =
              prompt('Printer target', 'tcp://192.168.0.100:9100') ?? '';
            try {
              await invoke('print_raw', {
                target,
                data: Array.from(new TextEncoder().encode(zpl)),
              });
              setStatus('printed');
            } catch (e) {
              setStatus(`print error: ${e}`);
            }
          }}
        >
          Test print
        </Button>
      </section>

      <section>
        <h2 className="font-medium">Auth</h2>
        <Button className="mt-2" onClick={onLogin}>
          Login
        </Button>
      </section>

      <p className="text-sm text-gray-600">{status}</p>
    </div>
  );
}
