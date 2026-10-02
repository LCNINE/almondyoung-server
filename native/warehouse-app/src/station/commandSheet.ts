import type { ActionSpec } from './actions';
import { encodeCode128B } from './code128';
import { commandCodeOfDigit, commandCodeOfKey } from './commandCode';
import { STATION_TABS } from './tabs';

export interface CommandSheetSection {
  title: string;
  actions: readonly Pick<ActionSpec, 'key' | 'label'>[];
}

/**
 * 시트에 싣는 명령(스펙 §5.3). 탭 화면이 액션을 선언하면 그 화면의 절을 여기 더한다(PR C 의 「출고 검수」 절처럼).
 * 탭 전환은 기능키로 충분하지만 첫 절로 둔다 — 한글 IME 켠 PC 에서 명령 바코드가 읽히는지 바로 확인할 수 있다.
 */
export const COMMAND_SHEET_SECTIONS: readonly CommandSheetSection[] = [
  { title: '탭', actions: STATION_TABS.map((tab) => ({ key: tab.key, label: tab.label })) },
];

/** 키패드처럼 1~9 다음 0. */
export const SHEET_DIGITS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export interface SheetEntry {
  label: string;
  caption: string;
  code: string;
  bits: string;
}

export function keyEntry(action: Pick<ActionSpec, 'key' | 'label'>): SheetEntry {
  const code = commandCodeOfKey(action.key);
  return {
    label: action.label,
    caption: action.key === 'Escape' ? 'Esc' : action.key,
    code,
    bits: encodeCode128B(code),
  };
}

export function digitEntry(digit: number): SheetEntry {
  const code = commandCodeOfDigit(digit);
  return { label: String(digit), caption: '', code, bits: encodeCode128B(code) };
}
