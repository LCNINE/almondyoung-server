import { invoke } from '@tauri-apps/api/core';
import type { DevicePrefs } from '../../data/devicePrefs';
import { reportPrintOutcome, resetPrintOutcome } from './printerStatus';

/**
 * 이 PC 의 라벨 프린터 설정과 원시 인쇄(#913). 창고 XP-DT108B 는 USB 로 PC 에 물려 있어
 * 입력칸은 Windows 스풀러 이름을 받는다. `tcp://호스트:포트` 로 시작하면 raw TCP 대상으로 그대로 둔다 —
 * 스풀러가 없는 리눅스·macOS 스테이션(개발 PC)이 이 길로 출력한다.
 * 바이트는 core 가 다 만들어 준다: 여기서는 언어(ZPL/TSPL)를 모른 채 그대로 넘긴다.
 */
export type PrinterSlot = 'waybill' | 'label';
/** 송장 칸. 이름·값은 #913 그대로다 — 이미 설정된 PC 가 있다. */
export const LABEL_PRINTER_KEY = 'almondwms.labelPrinter';
/** 로케이션·SKU 바코드 라벨 칸(#1281). */
export const BARCODE_LABEL_PRINTER_KEY = 'almondwms.barcodeLabelPrinter';
const SLOT_KEY: Record<PrinterSlot, string> = {
  waybill: LABEL_PRINTER_KEY,
  label: BARCODE_LABEL_PRINTER_KEY,
};
const SPOOLER = 'spooler://';
const TCP = 'tcp://';

export const NO_LABEL_PRINTER_MESSAGE =
  '이 PC 에 라벨 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export const NO_PRINTER_MESSAGE =
  '이 PC 에 송장 프린터가 설정되지 않았어요. 설정에서 지정해 주세요.';
export const PRINTER_FAILURE_MESSAGE =
  '프린터로 보내지 못했어요. 전원·연결과 설정의 프린터 이름을 확인해 주세요.';

export function readPrinter(prefs: DevicePrefs, slot: PrinterSlot): string | null {
  const target = prefs.get(SLOT_KEY[slot]);
  return target ? target : null;
}

export function writePrinter(prefs: DevicePrefs, slot: PrinterSlot, name: string): void {
  // 붙여 넣은 `spooler://` 를 벗겨야 접두어가 겹치지 않는다 — 겹치면 인쇄가 전부 실패한다.
  const bare = printerNameOf(name.trim()).trim();
  const key = SLOT_KEY[slot];
  if (!bare) prefs.remove(key);
  else prefs.set(key, bare.startsWith(TCP) ? bare : `${SPOOLER}${bare}`);
  resetPrintOutcome(slot);
}

/** 송장 칸 래퍼 — 기존 호출부가 그대로 쓴다. */
export function readLabelPrinter(prefs: DevicePrefs): string | null {
  return readPrinter(prefs, 'waybill');
}

export function writeLabelPrinter(prefs: DevicePrefs, name: string): void {
  writePrinter(prefs, 'waybill', name);
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

export function makePrintRaw(slot: PrinterSlot): PrintRaw {
  return async (target, text) => {
    try {
      await invoke('print_raw', {
        target,
        data: Array.from(new TextEncoder().encode(text)),
      });
    } catch (error) {
      reportPrintOutcome(false, slot);
      throw new PrinterError(String(error));
    }
    reportPrintOutcome(true, slot);
  };
}

export const printRaw: PrintRaw = makePrintRaw('waybill');
export const printRawLabel: PrintRaw = makePrintRaw('label');
