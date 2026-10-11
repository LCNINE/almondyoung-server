// wallet 환불 행의 실행 방식(#1016 36번 재설계 §6.3). «계좌 송금»은 운영자가 송금 뒤 결제 상세에서 [완료 처리]를 눌러야 끝난다.
export function refundExecutionLabel(execution: unknown): string {
  return execution === 'MANUAL' ? '계좌 송금' : '';
}
