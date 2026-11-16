/**
 * 닫기 판정 (DB 없음, 순수 함수).
 * 사람이 셀메이트에 재고를 올린 뒤, 한 품목의 업로드가 제대로 반영됐는지 판정한다.
 * Δc = 현재재고 변화, Δu = 미발송주문 변화 (업로드 시점 기준).
 */

export type CloseVerdict =
  | 'ok_new_orders'
  | 'ok_shipped_after'
  | 'ok_return_after'
  | 'shipped_before_upload'
  | 'mismatch'
  | 'missing';

export type CloseInput = {
  uploadedCurrent: number;
  refUnshipped: number;
  now: { current: number; unshipped: number } | null;
  /**
   * 직전 닫기 시도가 고친 CSV 를 만들며 비교 기준을 바꿨고 그 뒤로 아직 통과하지 못했다(isFixPending).
   * 그 상태의 «현재만 늘었다»는 반품이 아니라 «고친 파일을 아직 안 올렸다»와 구별되지 않으므로 ✗ 로 본다.
   */
  fixPending?: boolean;
};

export function judgeClose(i: CloseInput): { verdict: CloseVerdict; correctedCurrent: number | null } {
  if (i.now === null) {
    return { verdict: 'missing', correctedCurrent: null };
  }
  const dc = i.now.current - i.uploadedCurrent;
  const du = i.now.unshipped - i.refUnshipped;

  if (dc === 0 && du >= 0) {
    return { verdict: 'ok_new_orders', correctedCurrent: null };
  }
  if (dc === du && du < 0) {
    return { verdict: 'ok_shipped_after', correctedCurrent: null };
  }
  if (du === 0 && dc > 0) {
    // 고친 값(X+Δu)을 기준으로 둔 품목에 옛 CSV(현재 X)를 다시 넣으면 dc = −Δu > 0 으로 반품처럼 보인다.
    // 통과시키면 기준값이 실제보다 |Δu| 작아지고 다음 apply 가 이미 나간 수량을 ADJUST_UP 한다.
    if (i.fixPending) return { verdict: 'mismatch', correctedCurrent: null };
    return { verdict: 'ok_return_after', correctedCurrent: null };
  }
  if (dc === 0 && du < 0) {
    return { verdict: 'shipped_before_upload', correctedCurrent: i.uploadedCurrent + du };
  }
  return { verdict: 'mismatch', correctedCurrent: null };
}

/**
 * 회차 품목의 비교 기준이 고친 CSV 로 바뀌었고(apply 때 올린 값·받을 때 미발송과 다르다) 그 뒤 아직 통과 판정을 받지 못했나.
 * 저장된 판정이 ✗ 인 동안은 계속 true — 고친 파일을 안 올린 채 두 번, 세 번 다시 닫아도 반품으로 통과하지 않는다.
 */
export function isFixPending(item: {
  uploadAvail: number;
  sellmateUnshipped: number;
  uploadedCurrent: number;
  refUnshipped: number;
  closeVerdict: string | null;
}): boolean {
  const rewritten =
    item.uploadedCurrent !== item.uploadAvail + item.sellmateUnshipped || item.refUnshipped !== item.sellmateUnshipped;
  const passed = item.closeVerdict !== null && isOkVerdictName(item.closeVerdict);
  return rewritten && !passed;
}

function isOkVerdictName(v: string): boolean {
  return v === 'ok_new_orders' || v === 'ok_shipped_after' || v === 'ok_return_after';
}

export function isOkVerdict(v: CloseVerdict): boolean {
  return v === 'ok_new_orders' || v === 'ok_shipped_after' || v === 'ok_return_after';
}

export type Accept = 'landed' | 'not_landed' | null;

/** 확정 기준값. 반영 안 됐다고 확인되면 적용 전 셀메이트 가용을 쓰고, 그 밖에는 업로드 현재 − 기준 미발송을 쓴다. */
export function confirmedBaseline(a: {
  uploadedCurrent: number;
  refUnshipped: number;
  applyS: number;
  accept: Accept;
}): number {
  if (a.accept === 'not_landed') {
    return a.applyS;
  }
  return a.uploadedCurrent - a.refUnshipped;
}
