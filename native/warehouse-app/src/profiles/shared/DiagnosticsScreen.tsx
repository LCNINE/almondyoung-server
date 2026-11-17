import { useDeveloperMode } from '../../core/diagnostics/DeveloperModeProvider';
import { readDiagnostics } from '../../core/diagnostics/operationDiagnostics';
import { useState } from 'react';
import { Button } from '../../core/design/Button';
import { useScanner, useScanEmit } from '../../core/hardware/scan/useScanner';
import { scanWithCamera } from '../../core/hardware/scan/camera';
import { renderTestLabel, renderTestLabel50x30 } from '../../core/hardware/print/zpl';
import {
  NO_LABEL_PRINTER_MESSAGE,
  NO_PRINTER_MESSAGE,
  printRaw,
  printRawLabel,
  readPrinter,
  type PrintRaw,
  type PrinterSlot,
} from '../../core/hardware/print/labelPrinter';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
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

      <PrinterDiagnostics onStatus={setStatus} />

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

const SLOTS: { slot: PrinterSlot; title: string; empty: string }[] = [
  { slot: 'waybill', title: '송장 프린터', empty: NO_PRINTER_MESSAGE },
  { slot: 'label', title: '라벨 프린터', empty: NO_LABEL_PRINTER_MESSAGE },
];

/** 칸마다 설정에 저장된 대상으로 테스트 인쇄한다 — 대상을 prompt 로 묻지 않는다. */
export function PrinterDiagnostics({
  onStatus,
  prefs = localStoragePrefs,
  prints = { waybill: printRaw, label: printRawLabel },
}: {
  onStatus: (text: string) => void;
  prefs?: DevicePrefs;
  prints?: Record<PrinterSlot, PrintRaw>;
}) {
  const run = async (slot: PrinterSlot, empty: string) => {
    const target = readPrinter(prefs, slot);
    if (!target) {
      onStatus(empty);
      return;
    }
    const zpl =
      slot === 'label'
        ? renderTestLabel50x30()
        : renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' });
    try {
      await prints[slot](target, zpl);
      onStatus('printed');
    } catch (e) {
      onStatus(`print error: ${e}`);
    }
  };
  return (
    <section>
      <h2 className="font-medium">Printer</h2>
      <div className="flex gap-2">
        {SLOTS.map(({ slot, title, empty }) => (
          <Button key={slot} onClick={() => void run(slot, empty)}>
            {title} 테스트 인쇄
          </Button>
        ))}
      </div>
    </section>
  );
}
