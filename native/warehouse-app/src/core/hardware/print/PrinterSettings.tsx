import { useRef, useState } from 'react';
import { Button } from '../../design/Button';
import { localStoragePrefs, type DevicePrefs } from '../../data/devicePrefs';
import { renderTestLabel, renderTestLabel50x30 } from './zpl';
import {
  NO_LABEL_PRINTER_MESSAGE,
  NO_PRINTER_MESSAGE,
  PRINTER_FAILURE_MESSAGE,
  PrinterError,
  printRaw,
  printRawLabel,
  printerNameOf,
  readPrinter,
  writePrinter,
  type PrintRaw,
  type PrinterSlot,
} from './labelPrinter';

type Status = { kind: 'ok' | 'error'; text: string; detail?: string };

const TITLE: Record<PrinterSlot, string> = { waybill: '송장 프린터', label: '라벨 프린터' };
const HELP: Record<PrinterSlot, string> = {
  waybill: '이 PC 에 연결된 송장 프린터의 이름을 적어 주세요.',
  label: '이 PC 에 연결된 라벨(바코드 스티커) 프린터의 이름을 적어 주세요.',
};
const EMPTY_MESSAGE: Record<PrinterSlot, string> = {
  waybill: NO_PRINTER_MESSAGE,
  label: NO_LABEL_PRINTER_MESSAGE,
};

/** 설정 화면의 프린터 절. 칸(송장·라벨)마다 이 PC 에 물린 프린터의 Windows 이름을 받는다(#913·#1281). */
export function PrinterSettings({
  slot,
  prefs = localStoragePrefs,
  print = slot === 'label' ? printRawLabel : printRaw,
}: {
  slot: PrinterSlot;
  prefs?: DevicePrefs;
  print?: PrintRaw;
}) {
  const title = TITLE[slot];
  const [name, setName] = useState(() => printerNameOf(readPrinter(prefs, slot) ?? ''));
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타는 ref 로 막아야 테스트 라벨이 두 장 안 나온다.
  const running = useRef(false);

  const save = (): string | null => {
    writePrinter(prefs, slot, name);
    const saved = readPrinter(prefs, slot);
    setName(printerNameOf(saved ?? ''));
    return saved;
  };

  const testPrint = async () => {
    if (running.current) return;
    // 입력만 하고 저장을 안 누른 채 시험하는 게 자연스러워서, 시험 전에 저장한다.
    const target = save();
    if (!target) {
      setStatus({ kind: 'error', text: EMPTY_MESSAGE[slot] });
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      await print(
        target,
        slot === 'label'
          ? renderTestLabel50x30()
          : renderTestLabel({ title: 'ALMOND WMS', barcode: '8801234' }),
      );
      setStatus({ kind: 'ok', text: `${title} 로 테스트를 보냈어요. 프린터에서 나왔는지 확인해 주세요.` });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: PRINTER_FAILURE_MESSAGE,
        detail: error instanceof PrinterError ? error.detail : String(error),
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <p className="text-xs text-gray-500">
        {HELP[slot]} Windows 설정 → 프린터 및 스캐너에 보이는 이름 그대로예요.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = save();
          setStatus({ kind: 'ok', text: saved ? '저장했어요.' : `${title} 설정을 지웠어요.` });
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label={`${title} 이름`}
          placeholder={slot === 'label' ? '예: TX400' : '예: XP-DT108B'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" aria-label={`${title} 저장`}>
          저장
        </Button>
      </form>
      <Button
        type="button"
        className="border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        disabled={busy}
        onClick={() => void testPrint()}
      >
        {title} 테스트 인쇄
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
