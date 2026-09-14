import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { readDiagnostics } from '../../core/diagnostics/operationDiagnostics';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel } from '../../core/hardware/print/zpl';
import type { ScanEvent } from '../../core/hardware/scan/ScanProvider';
import { useSession, useIsAuthenticated } from '../../app/session-context';

export function DiagnosticsScreen() {
  const developer = useDeveloperMode();
  return developer.enabled ? (
    <AuthorizedDiagnostics />
  ) : (
    <p>설정에서 개발자 모드를 켜 주세요. 관리자 권한이 필요해요.</p>
  );
}
function AuthorizedDiagnostics() {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState('');
  const emit = useScanEmit();
  const session = useSession();
  const authed = useIsAuthenticated();
  useScanner((e) => setScans((s) => [e, ...s].slice(0, 20)));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Diagnostics</h1>

      <section>
        <h2 className="font-medium">Scans (HID + camera)</h2>
        <ul className="mt-1 max-h-40 overflow-auto text-sm">
          {scans.map((s, i) => (
            <li key={i}>[{s.source}] 입력 확인</li>
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
        <p className="text-sm">
          {authed ? 'authenticated' : 'not authenticated'}
        </p>
        <Button className="mt-2" onClick={() => session.logout()}>
          Logout
        </Button>
      </section>

      <section>
        <h2>작업 진단</h2>
        <pre className="overflow-auto text-xs">
          {JSON.stringify(readDiagnostics(), null, 2)}
        </pre>
      </section>
      <p className="text-sm text-gray-600">{status}</p>
    </div>
  );
}
