import { useRef, useState } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import {
  PrinterError,
  printRawLabel,
  readPrinter,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
import type { LabelBatch } from './labelApi';

export const SKU_LABEL_SIZE_KEY = 'almondwms.skuLabelSize';

export type PrintResult =
  | { kind: 'sent'; labels: number; skipped: LabelBatch['skipped'] }
  | { kind: 'nothing'; skipped: LabelBatch['skipped'] }
  | { kind: 'no-printer' }
  | { kind: 'printer-error'; detail: string };

/**
 * 라벨 칸 프린터로 «받아 온 ZPL» 을 보낸다(#1281). 라벨 칸이 비면 서버를 부르지 않는다 —
 * 송장 칸으로 새지 않는다. API 오류는 던져서 부른 쪽이 errorMessage 로 보인다.
 */
export function usePrintLabels(
  prefs: DevicePrefs = localStoragePrefs,
  print: PrintRaw = printRawLabel,
): { run: (fetch: () => Promise<LabelBatch>) => Promise<PrintResult>; busy: boolean } {
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타는 ref 로 막아야 라벨이 두 번 안 나온다.
  const running = useRef(false);

  const run = async (fetch: () => Promise<LabelBatch>): Promise<PrintResult> => {
    const target = readPrinter(prefs, 'label');
    if (!target) return { kind: 'no-printer' };
    if (running.current) return { kind: 'nothing', skipped: [] };
    running.current = true;
    setBusy(true);
    try {
      const batch = await fetch();
      if (batch.data === '') return { kind: 'nothing', skipped: batch.skipped };
      try {
        await print(target, batch.data);
      } catch (error) {
        return {
          kind: 'printer-error',
          detail: error instanceof PrinterError ? error.detail : String(error),
        };
      }
      return { kind: 'sent', labels: batch.labels, skipped: batch.skipped };
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return { run, busy };
}
