import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel } from '../../core/hardware/print/zpl';
import type { ScanEvent } from '../../core/hardware/scan/ScanProvider';

export function DiagnosticsScreen() {
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState('');
  const emit = useScanEmit();
  useScanner((e) => setScans((s) => [e, ...s].slice(0, 20)));

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

      <p className="text-sm text-gray-600">{status}</p>
    </div>
  );
}
