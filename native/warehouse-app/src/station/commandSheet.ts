import type { ActionSpec } from './actions';
import { encodeCode128B } from './code128';
import { commandCodeOfDigit, commandCodeOfKey } from './commandCode';
import { INSPECTION_ACTIONS } from './outbound/inspectionActions';
import { RETURNS_ACTIONS } from './returns/returnsActions';
import { STATION_TABS } from './tabs';

export interface CommandSheetSection {
  title: string;
  actions: readonly Pick<ActionSpec, 'key' | 'label'>[];
}

/**
 * 같은 키의 액션을 한 칸으로 — 시트는 키마다 바코드 하나다. 화면은 상태마다 둘 중 하나만 선언하므로(반품의 F10 = 도착 확정 또는
 * 검수 확정) 같은 바코드를 두 장 싣지 않고 이름만 «·» 로 잇는다. 순서는 처음 나온 자리.
 */
function mergeByKey(actions: readonly Pick<ActionSpec, 'key' | 'label'>[]): Pick<ActionSpec, 'key' | 'label'>[] {
  const labels = new Map<ActionSpec['key'], string[]>();
  for (const action of actions) labels.set(action.key, [...(labels.get(action.key) ?? []), action.label]);
  return [...labels].map(([key, names]) => ({ key, label: names.join(' · ') }));
}

/**
 * 시트에 싣는 명령(스펙 §5.3). 탭 화면이 액션을 선언하면 그 화면의 절을 여기 더한다(PR C 의 「출고 검수」 절처럼).
 * 탭 전환은 기능키로 충분하지만 첫 절로 둔다 — 한글 IME 켠 PC 에서 명령 바코드가 읽히는지 바로 확인할 수 있다.
 */
export const COMMAND_SHEET_SECTIONS: readonly CommandSheetSection[] = [
  { title: '탭', actions: STATION_TABS.map((tab) => ({ key: tab.key, label: tab.label })) },
  // 화면 선언과 같은 상수 — 시트와 기능키 바가 갈리지 않는다(PR B 계약 메모)
  { title: '출고 검수', actions: Object.values(INSPECTION_ACTIONS) },
  // Esc 는 «목록»(소포 세기·검수에서 나가기)으로만 적는다 — 목록 화면에서는 같은 Esc 가 «검색 지우기»다
  {
    title: '반품',
    actions: mergeByKey([
      RETURNS_ACTIONS.search,
      RETURNS_ACTIONS.confirmArrival,
      RETURNS_ACTIONS.confirmInspection,
      RETURNS_ACTIONS.back,
    ]),
  },
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
