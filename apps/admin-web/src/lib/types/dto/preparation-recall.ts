// 출고를 되돌려 출고 준비로 돌아온 상자
export interface PreparationRecallReturn {
  recalledAt: string;
  // 되돌릴 때 고른 사유. 기록에서 찾지 못하면 null
  reasonCode: string | null;
  reason: string | null;
  // 다시 준비하면 새 송장을 받는다
  needsNewWaybill: boolean;
}
