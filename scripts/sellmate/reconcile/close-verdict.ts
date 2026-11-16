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
    return { verdict: 'ok_return_after', correctedCurrent: null };
  }
  if (dc === 0 && du < 0) {
    return { verdict: 'shipped_before_upload', correctedCurrent: i.uploadedCurrent + du };
  }
  return { verdict: 'mismatch', correctedCurrent: null };
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
