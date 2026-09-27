import { useState } from 'react';
import { Button } from '../../design/Button';
import { localStoragePrefs, type DevicePrefs } from '../../data/devicePrefs';
import { renderTestLabel } from './zpl';
import {
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  printRaw,
  printerNameOf,
  readLabelPrinter,
  writeLabelPrinter,
  type PrintRaw,
} from './labelPrinter';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

/** 설정 화면의 「라벨 프린터」 절. 이 PC 에 물린 운송장 프린터의 Windows 이름을 받는다(#913). */
export function LabelPrinterSettings({
  prefs = localStoragePrefs,
  print = printRaw,
}: {
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const [name, setName] = useState(() => printerNameOf(readLabelPrinter(prefs) ?? ''));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (): string | null => {
    writeLabelPrinter(prefs, name);
    const saved = readLabelPrinter(prefs);
    setName(printerNameOf(saved ?? ''));
    return saved;
  };

  const testPrint = async () => {
    // 입력만 하고 저장을 안 누른 채 시험하는 게 자연스러워서, 시험 전에 저장한다.
    const target = save();
    if (!target) {
      setStatus({ kind: 'error', text: NO_PRINTER_MESSAGE });
      return;
    }
    setBusy(true);
    try {
      await print(target, renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' }));
      setStatus({ kind: 'ok', text: '테스트 라벨을 보냈어요. 프린터에서 나왔는지 확인해 주세요.' });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: PRINTER_FAILURE_MESSAGE,
        detail: error instanceof PrinterError ? error.detail : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">라벨 프린터</h2>
      <p className="text-xs text-gray-500">
        이 PC 에 연결된 운송장 프린터의 이름을 적어 주세요. Windows 설정 → 프린터 및 스캐너에 보이는 이름 그대로예요.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = save();
          setStatus({ kind: 'ok', text: saved ? '저장했어요.' : '라벨 프린터 설정을 지웠어요.' });
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="라벨 프린터 이름"
          placeholder="예: XP-DT108B"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit">저장</Button>
      </form>
      <Button
        type="button"
        className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        disabled={busy}
        onClick={() => void testPrint()}
      >
        테스트 인쇄
      </Button>
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className="text-sm">
          {status.text}
          {status.detail && <span className="block text-xs text-gray-500">{status.detail}</span>}
        </p>
      )}
    </section>
  );
}
