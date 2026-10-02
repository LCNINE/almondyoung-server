export const FUNCTION_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'] as const;
export type FunctionKey = (typeof FUNCTION_KEYS)[number];

/** 탭 전환 키(스펙 §4). 셸 자신의 액션이다. */
export const TAB_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export type StationKey = FunctionKey | 'Escape';

/** 기능키 바·명령 시트가 그리는 순서. Esc 는 맨 끝(바에서는 오른쪽 끝). */
export const STATION_KEYS: readonly StationKey[] = [...FUNCTION_KEYS, 'Escape'];

export interface KeyLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * 셸이 처리할 키인가. 수식키가 붙은 조합은 OS·웹뷰 몫이라 건드리지 않는다 — Alt+F4 로 창이 닫혀야 하고,
 * Shift+F10(문맥 메뉴)·Ctrl+F5 를 셸 액션으로 오인하면 안 된다.
 */
export function stationKeyOf(ev: KeyLike): StationKey | null {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return null;
  return STATION_KEYS.find((key) => key === ev.key) ?? null;
}
