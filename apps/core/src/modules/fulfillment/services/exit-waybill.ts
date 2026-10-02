import type { WaybillView } from '../waybill/waybill.types';

/**
 * 박스가 배치를 떠날 때 활성 송장을 무효화해도 되는가 — 없거나 아직 carrier 에 등록만 된 상태(registered)일 때만.
 * 그 이상(발송·인수 등)은 사람이 먼저 풀어야 한다. 취소 이탈(BoxWithdrawalService)과 결품 이탈(ShortPickExitService)이 같은 판정을 쓴다.
 */
export function isVoidableOnExit(active: WaybillView | null): boolean {
  return !active || active.status === 'registered';
}
