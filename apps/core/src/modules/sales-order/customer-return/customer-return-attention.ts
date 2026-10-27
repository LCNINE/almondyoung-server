import type { CustomerReturnPrepayment, CustomerReturnSettlement, CustomerReturnStatus } from './customer-return.types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REFUND_BUSINESS_DAYS = 3;

/**
 * 환불 기한 — 도착한 KST 날짜의 «다음 날»부터 센 3번째 평일의 23:59:59.999 KST.
 * 초일 불산입, 공휴일은 무시(보수적으로 짧게). 한국은 서머타임이 없어 +9h 고정 산술로 계산한다
 * (런타임 TZ 에 기대지 않는다).
 */
export function refundDueAt(arrivedAt: Date): Date {
  const day = new Date(arrivedAt.getTime() + KST_OFFSET_MS);
  day.setUTCHours(0, 0, 0, 0);
  let counted = 0;
  while (counted < REFUND_BUSINESS_DAYS) {
    day.setUTCDate(day.getUTCDate() + 1);
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) counted += 1;
  }
  // KST 23:59:59.999 = 같은 날짜의 UTC 14:59:59.999
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 14, 59, 59, 999));
}

export type CustomerReturnAttention =
  | 'held'
  | 'settlement_failed'
  | 'prepayment_failed'
  | 'partial_arrival'
  | 'refund_overdue';

export type CustomerReturnAttentionInput = {
  status: CustomerReturnStatus;
  arrivedAt: Date | null;
  settlementState: CustomerReturnSettlement['state'] | null;
  prepaymentState: CustomerReturnPrepayment['state'] | null;
  expectedQty: number;
  arrivedQty: number;
  missingQty: number;
};

/** «확인 필요» 판정 — 순서 고정(N5). 정상 상태는 빈 배열이다. */
export function customerReturnAttention(input: CustomerReturnAttentionInput, now: Date): CustomerReturnAttention[] {
  const out: CustomerReturnAttention[] = [];
  if (input.status === 'held') out.push('held');
  if (input.settlementState === 'refused' || input.settlementState === 'stalled') out.push('settlement_failed');
  if (input.prepaymentState === 'refused' || input.prepaymentState === 'stalled') out.push('prepayment_failed');
  // 닫기 전에는 검수가 거절된다 — missingQty 가 있으면 이미 닫은 것이다
  if (input.status === 'arrived' && input.arrivedQty < input.expectedQty && input.missingQty === 0) {
    out.push('partial_arrival');
  }
  // 환불이 나간 반품(정산 완료·선환불 done)과 취소는 기한을 따지지 않는다
  const refunded = input.status === 'settled' || input.status === 'cancelled' || input.prepaymentState === 'done';
  if (input.arrivedAt && !refunded && now.getTime() > refundDueAt(input.arrivedAt).getTime()) {
    out.push('refund_overdue');
  }
  return out;
}
