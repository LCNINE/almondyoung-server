import type { RefundExecution, RefundStatus } from '../schema';

/**
 * 운영자가 [송금 완료](confirmManual)로 닫을 수 있는 환불 행인가.
 * 수동 실행(MANUAL) 행은 결제수단과 무관하게, 무통장은 지금처럼 계좌를 몰라 PENDING 으로 떨어진 행을 받는다.
 * PG 가 처리 중인 AUTO PENDING 은 받지 않는다 — 사람이 닫으면 PG 결과와 갈린다.
 */
export function isManuallyConfirmable(r: {
  status: RefundStatus;
  execution: RefundExecution;
  methodType: string | null;
}): boolean {
  return r.status === 'PENDING' && (r.execution === 'MANUAL' || r.methodType === 'BANK_TRANSFER');
}
