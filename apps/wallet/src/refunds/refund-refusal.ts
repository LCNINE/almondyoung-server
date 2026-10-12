/**
 * wallet 이 환불 요청을 4xx 로 거절할 때의 본문 — `{ error, message, retryable }`.
 *
 * error·message 는 옛 모양 그대로다: core WalletRefundClient 가 body.error 로 금액 초과류를 «이미 환불됨»으로 읽는다.
 * retryable 은 «같은 요청을 나중에 다시 보내면 될 수 있는가» — almond-payment 가 영구 거절과 일시 실패를 가른다(스펙 §6.4).
 * 코드를 더하면 이 표에 판정을 함께 적어야 컴파일된다.
 */
const RETRYABLE = {
  // 금액 초과류: 호출자 장부와 wallet 이 어긋난 경합(동시 환불 등)이다. 장부를 맞춘 다음 시도가 남은 몫만 보낸다(스펙 §6.2)
  REFUND_AMOUNT_EXCEEDS_CHARGE: true,
  REFUND_AMOUNT_EXCEEDS_AVAILABLE: true,
  REFUND_AMOUNT_EXCEEDS_TOTAL: true,
  // 결제수단·정책·데이터가 막는다 — 다시 보내도 같다
  REFUND_NOT_AUTOMATABLE: false,
  MEMBERSHIP_REFUND_NOT_ALLOWED: false,
  CHARGE_NOT_FOUND: false,
  CHARGE_INTENT_MISMATCH: false,
  CHARGE_NOT_REFUNDABLE: false,
  PAYMENT_METHOD_NOT_FOUND: false,
  INTENT_NOT_FOUND: false,
  REFUNDABLE_CHARGE_NOT_FOUND: false,
} as const satisfies Record<string, boolean>;

export type WalletRefundRefusalCode = keyof typeof RETRYABLE;

export function refundRefusal(
  error: WalletRefundRefusalCode,
  message: string,
): { error: WalletRefundRefusalCode; message: string; retryable: boolean } {
  return { error, message, retryable: RETRYABLE[error] };
}
