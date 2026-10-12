/**
 * 토스 결제 취소(환불) 오류 코드 → 같은 환불을 나중에 다시 시도하면 될 수 있는가.
 * 출처: docs.tosspayments.com/reference/error-codes «결제 취소» (2026-10-11 확인, 31개).
 *
 * false(영구)면 정산 재시도가 멈추고 운영자가 «계좌 송금으로 환불»을 고른다. true(일시)면 core 리컨실러가 다시 부른다.
 * 모르는 코드는 true — 영구로 잘못 두면 아무도 다시 안 부르지만, 일시로 잘못 두면 «환불 지연»으로 사람 눈에 띈다(스펙 §6.5).
 */
export const TOSS_REFUND_ERROR_RETRYABLE: ReadonlyMap<string, boolean> = new Map([
  // 400
  ['ALREADY_CANCELED_PAYMENT', false],
  ['INVALID_REFUND_ACCOUNT_INFO', false], // 계좌번호·예금주 불일치 — 라이브 FAILED 의 최다 사유
  ['EXCEED_CANCEL_AMOUNT_DISCOUNT_AMOUNT', false],
  ['INVALID_REQUEST', false],
  ['INVALID_REFUND_ACCOUNT_NUMBER', false],
  ['INVALID_BANK', false],
  ['NOT_MATCHES_REFUNDABLE_AMOUNT', false], // 토스 잔액과 요청이 다르다 — 같은 요청은 또 다르다
  ['PROVIDER_ERROR', true],
  ['REFUND_REJECTED', false],
  ['ALREADY_REFUND_PAYMENT', false],
  ['FORBIDDEN_BANK_REFUND_REQUEST', false],
  // 401·403
  ['UNAUTHORIZED_KEY', true], // 우리 키 설정 문제 — 배포로 고치면 풀린다
  ['NOT_CANCELABLE_AMOUNT', false],
  ['FORBIDDEN_CONSECUTIVE_REQUEST', true],
  ['FORBIDDEN_REQUEST', false],
  ['NOT_CANCELABLE_PAYMENT', false],
  ['EXCEED_MAX_REFUND_DUE', false],
  ['NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT', false],
  ['NOT_ALLOWED_PARTIAL_REFUND', false],
  ['NOT_AVAILABLE_BANK', true], // 은행 서비스 시간 밖
  ['INCORRECT_BASIC_AUTH_FORMAT', true], // 우리 설정 문제
  ['NOT_CANCELABLE_PAYMENT_FOR_DORMANT_USER', false],
  ['EXCEED_CANCEL_LIMIT', true], // 취소 한도 — 시간이 지나면 풀릴 수 있어 일시 쪽
  // 404
  ['NOT_FOUND_PAYMENT', false],
  // 500
  ['FAILED_INTERNAL_SYSTEM_PROCESSING', true],
  ['FAILED_CARD_COMPANY_RESPONSE', true],
  ['FAILED_REFUND_PROCESS', true],
  ['FAILED_METHOD_HANDLING_CANCEL', true],
  ['FAILED_PARTIAL_REFUND', true], // «은행 점검·해약 계좌» — 영구·일시가 섞여 있어 기본값(일시) 쪽
  ['COMMON_ERROR', true],
  ['FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING', true],
]);

export function isTossRefundRetryable(code: string | undefined): boolean {
  if (!code) return true;
  return TOSS_REFUND_ERROR_RETRYABLE.get(code) ?? true;
}
