// wallet 환불 행의 실행 방식(#1016 36번 재설계 §6.3). «계좌 송금»은 운영자가 송금 뒤 «환불 내역»의 [완료 처리]를 눌러야 끝난다.
export function refundExecutionLabel(execution: unknown): string {
  return execution === 'MANUAL' ? '계좌 송금' : '';
}

/** 결제 상세 사이드바에서 환불 결과가 PENDING 일 때. 무통장만 사람이 닫는다 — 카드 AUTO PENDING 은 PG 결과를 기다린다 */
export function pendingRefundToast(isBankTransfer: boolean): string {
  return isBankTransfer
    ? '환불 대기 중: 무통장 입금 환불은 수동 송금이 필요합니다. 송금 뒤 환불 내역에서 [완료 처리]를 눌러 주세요.'
    : '환불 접수됨: PG 처리 결과를 기다리고 있습니다.';
}

/** «환불 내역»의 실패 사유 칸. FAILED 가 아니면 빈 칸(정상 상태는 숨긴다) */
export function refundFailureLabel(r: { status: string; failureCode?: string | null; retryable?: boolean | null }): string {
  if (r.status !== 'FAILED' || !r.failureCode) return '';
  return r.retryable === false ? `${r.failureCode} · 다시 시도 불가` : r.failureCode;
}
