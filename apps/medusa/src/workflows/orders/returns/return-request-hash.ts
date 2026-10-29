import { createHash } from 'crypto';

export type ReturnRequestKind = 'return' | 'exchange';

/**
 * 같은 요청인지 — 품목(정렬)·사유·CS 가 고른 부담 주체. 메모·기한 넘김 사유는 넣지 않는다(재시도 때 문구만 달라도 같은 요청이다).
 * K8 PR11 N1 — `kind` 키는 교환일 때만 더한다. 반품(kind 없음·return)의 본문은 PR 11 이전과 바이트까지 같아야
 * 옛 반품의 재전송이 request_id_conflict 가 되지 않는다.
 */
export function hashReturnRequest(
  items: Array<{ itemId: string; quantity: number }>,
  reasonValue: string,
  operatorFeeBearer: 'customer' | 'seller' | undefined,
  kind?: ReturnRequestKind,
): string {
  const body = {
    items,
    reasonValue,
    operatorFeeBearer: operatorFeeBearer ?? null,
    ...(kind === 'exchange' ? { kind } : {}),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
