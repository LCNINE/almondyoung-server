import type { ActionSpec } from '../actions';

/**
 * 출고 검수(F1)의 액션(스펙 §6.3). 화면 선언과 명령 바코드 시트가 같은 값을 쓴다 — 시트의 「출고 검수」 절이 이것이다.
 * 화면은 상태에 따라 라벨만 바꿔 그린다(Esc 가 «수량 취소»·«취소», F10 이 «강제출고 확정» 이 되는 식). 시트에는 이 라벨이 실린다.
 * 탭 키(F1~F7)는 쓰지 않는다 — 수량은 숫자를 치면 바로 시작한다.
 */
export const INSPECTION_ACTIONS = {
  all: { id: 'inspect-all', key: 'F8', label: '이 상품 전량' },
  shortPick: { id: 'inspect-short-pick', key: 'F9', label: '결품' },
  force: { id: 'inspect-force', key: 'F10', label: '강제출고' },
  withdraw: { id: 'inspect-withdraw', key: 'F11', label: '박스 빼기' },
  reprint: { id: 'inspect-reprint', key: 'F12', label: '송장 재출력' },
  putDown: { id: 'inspect-put-down', key: 'Escape', label: '내려놓기' },
} as const satisfies Record<string, ActionSpec>;

/** 빠진 상자 화면에서만 — 탭 이동(F4 적치·이동)을 덮어 꺼낸 상품의 되돌림 적치로 바로 간다 */
export const RETURN_PUTAWAY_ACTION = {
  id: 'inspect-return-putaway',
  key: 'F4',
  label: '되돌림 적치',
} as const satisfies ActionSpec;
