import { TOSS_REFUND_ERROR_RETRYABLE, isTossRefundRetryable } from './toss-refund-errors';

/** 다시 보내도 같은 답 — 사람이 다른 수단(계좌 송금)을 골라야 한다 */
const PERMANENT = [
  'ALREADY_CANCELED_PAYMENT',
  'INVALID_REFUND_ACCOUNT_INFO',
  'EXCEED_CANCEL_AMOUNT_DISCOUNT_AMOUNT',
  'INVALID_REQUEST',
  'INVALID_REFUND_ACCOUNT_NUMBER',
  'INVALID_BANK',
  'NOT_MATCHES_REFUNDABLE_AMOUNT',
  'REFUND_REJECTED',
  'ALREADY_REFUND_PAYMENT',
  'FORBIDDEN_BANK_REFUND_REQUEST',
  'NOT_CANCELABLE_AMOUNT',
  'FORBIDDEN_REQUEST',
  'NOT_CANCELABLE_PAYMENT',
  'EXCEED_MAX_REFUND_DUE',
  'NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT',
  'NOT_ALLOWED_PARTIAL_REFUND',
  'NOT_CANCELABLE_PAYMENT_FOR_DORMANT_USER',
  'NOT_FOUND_PAYMENT',
];

/** 시간이 지나거나 우리 설정을 고치면 풀린다 */
const RETRYABLE = [
  'PROVIDER_ERROR',
  'UNAUTHORIZED_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
  'FORBIDDEN_CONSECUTIVE_REQUEST',
  'NOT_AVAILABLE_BANK',
  'EXCEED_CANCEL_LIMIT',
  'FAILED_INTERNAL_SYSTEM_PROCESSING',
  'FAILED_CARD_COMPANY_RESPONSE',
  'FAILED_REFUND_PROCESS',
  'FAILED_METHOD_HANDLING_CANCEL',
  'FAILED_PARTIAL_REFUND',
  'COMMON_ERROR',
  'FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING',
];

describe('토스 결제 취소 오류 코드표', () => {
  it('문서의 31개 코드를 전부 판정한다', () => {
    expect(TOSS_REFUND_ERROR_RETRYABLE.size).toBe(31);
    expect([...TOSS_REFUND_ERROR_RETRYABLE.keys()].sort()).toEqual([...PERMANENT, ...RETRYABLE].sort());
  });

  it.each(PERMANENT)('%s 는 영구(false)', (code) => {
    expect(isTossRefundRetryable(code)).toBe(false);
  });

  it.each(RETRYABLE)('%s 는 일시(true)', (code) => {
    expect(isTossRefundRetryable(code)).toBe(true);
  });

  it('모르는 코드·없는 코드·응답 본문을 못 읽은 UNKNOWN 은 일시(true)', () => {
    expect(isTossRefundRetryable('SOMETHING_NEW')).toBe(true);
    expect(isTossRefundRetryable(undefined)).toBe(true);
    expect(isTossRefundRetryable('UNKNOWN')).toBe(true);
    // Map 이라 Object.prototype 키에 속지 않는다
    expect(isTossRefundRetryable('constructor')).toBe(true);
  });
});
