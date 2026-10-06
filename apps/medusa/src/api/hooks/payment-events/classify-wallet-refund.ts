export type WalletRefundDecision = 'skip_medusa_originated' | 'skip_already_recorded' | 'record_external';

/**
 * wallet 환불 사실 하나를 Medusa 장부에 넣어야 하는지 (ADR-0042 원칙 3).
 * 두 신호를 다 본다 — reasonCode 는 wallet 이 실어야 오고(배포 겹침 창엔 없을 수 있다), wallet 환불 id 는
 * Medusa 의 refund 행이 provider 응답을 저장한 뒤에야 생긴다. 둘 중 하나라도 «우리 것»이면 넣지 않는다.
 */
export function classifyWalletRefund(input: {
  refundId: string | undefined;
  reasonCode: string | undefined;
  knownWalletRefundIds: string[];
}): WalletRefundDecision {
  if (input.reasonCode === 'MEDUSA_REFUND') return 'skip_medusa_originated';
  if (!input.refundId || input.knownWalletRefundIds.includes(input.refundId)) return 'skip_already_recorded';
  return 'record_external';
}
