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

/**
 * Medusa 가 낸 환불(MEDUSA_REFUND)인데 provider 가 기록한 wallet 환불 id 에 없는가.
 * wallet 은 환불을 냈는데 응답이 유실되면 Medusa 는 자기 환불 행을 지우고, 재시도는 새 키로 또 낸다 — 그 고아 환불은
 * MEDUSA_REFUND 라 투영도 건너뛰어 어디에도 안 남는다. 이 판정이 참이면 로그로만 남긴다(던지지 않는다):
 * provider 가 walletRefundIds 를 쓰는 건 wallet 응답 «뒤»라, 사실이 그 쓰기보다 먼저 오면 정상인데도 참이 될 수 있다.
 */
export function isUnbookedMedusaRefund(input: {
  refundId: string | undefined;
  reasonCode: string | undefined;
  knownWalletRefundIds: string[];
}): boolean {
  return (
    classifyWalletRefund(input) === 'skip_medusa_originated' &&
    !!input.refundId &&
    !input.knownWalletRefundIds.includes(input.refundId)
  );
}
