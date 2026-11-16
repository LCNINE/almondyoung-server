import type { ActionSpec } from '../actions';

/**
 * 선적 상자 화면의 액션 표(F8~F12·Esc 만 — F1~F7 은 셸의 탭 키).
 * 화면은 상태마다 일부만 선언한다 — 한 층에 같은 키가 둘 오지 않게.
 */
export const INBOUND_BOX_ACTIONS = {
  listAs: { id: 'inbound-box-list-as', key: 'F8', label: '리스트대로' },
  unplanned: { id: 'inbound-box-unplanned', key: 'F9', label: '리스트에 없던 물건' },
  confirm: { id: 'inbound-box-confirm', key: 'F10', label: '확정' },
  cancelReceipt: { id: 'inbound-box-cancel-receipt', key: 'F11', label: '확정 취소' },
  addUnlisted: { id: 'inbound-box-add-unlisted', key: 'F12', label: '리스트에 없는 상자로 받기' },
  back: { id: 'inbound-box-back', key: 'Escape', label: '대기' },
} as const satisfies Record<string, ActionSpec>;
