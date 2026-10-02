import { invoke } from '@tauri-apps/api/core';
import type { DevicePrefs } from '../../data/devicePrefs';
import { reportPrintOutcome, resetPrintOutcome } from './printerStatus';

/**
 * 이 PC 의 라벨 프린터 설정과 원시 인쇄(#913). 창고 XP-DT108B 는 USB 로 PC 에 물려 있어
 * Windows 스풀러 이름만 받는다 — `print_raw` 는 `tcp://` 도 알지만 설정 UI 는 만들지 않았다.
 * 바이트는 core 가 다 만들어 준다: 여기서는 언어(ZPL/TSPL)를 모른 채 그대로 넘긴다.
 */
export const LABEL_PRINTER_KEY = 'almondwms.labelPrinter';
const SPOOLER = 'spooler://';

export const NO_PRINTER_MESSAGE =
  '이 PC 에 라벨 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export const PRINTER_FAILURE_MESSAGE =
  '프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.';

export function readLabelPrinter(prefs: DevicePrefs): string | null {
  const target = prefs.get(LABEL_PRINTER_KEY);
  return target ? target : null;
}

export function writeLabelPrinter(prefs: DevicePrefs, name: string): void {
  // 붙여 넣은 `spooler://` 를 벗겨야 접두어가 겹치지 않는다 — 겹치면 인쇄가 전부 실패한다.
  const bare = printerNameOf(name.trim()).trim();
  if (!bare) prefs.remove(LABEL_PRINTER_KEY);
  else prefs.set(LABEL_PRINTER_KEY, `${SPOOLER}${bare}`);
  resetPrintOutcome();
}

export function printerNameOf(target: string): string {
  return target.startsWith(SPOOLER) ? target.slice(SPOOLER.length) : target;
}

/** 프린터까지 못 간 실패. API 거절과 구별해야 배치가 «건너뛰기» 대신 «중단» 한다. */
export class PrinterError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`printer: ${detail}`);
    this.name = 'PrinterError';
    this.detail = detail;
  }
}

export type PrintRaw = (target: string, text: string) => Promise<void>;

export const printRaw: PrintRaw = async (target, text) => {
  try {
    await invoke('print_raw', {
      target,
      data: Array.from(new TextEncoder().encode(text)),
    });
  } catch (error) {
    reportPrintOutcome(false);
    throw new PrinterError(String(error));
  }
  reportPrintOutcome(true);
};
