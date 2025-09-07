// shared/types/payment-method.types.ts

/**
 * 결제 수단 타입 (업계 표준 열거형)
 */
export enum PaymentMethodType {
  CARD = 'CARD',
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  BNPL = 'BNPL',
  REWARD_POINT = 'REWARD_POINT',
}

/**
 * 결제 제공업체 타입
 */
export enum PaymentProvider {
  TOSS = 'TOSS',
  HMS_CARD = 'HMS_CARD',
  HMS_BNPL = 'HMS_BNPL',
  INTERNAL_POINT = 'INTERNAL_POINT',
}

/**
 * 결제 상태 타입
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIAL_REFUNDED = 'PARTIAL_REFUNDED',
}

/**
 * 환불 상태 타입
 */
export enum RefundStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * 타입 가드 함수들
 */
export const isImmediatePaymentType = (type: PaymentMethodType): boolean => {
  return [
    PaymentMethodType.CARD,
    PaymentMethodType.BANK_ACCOUNT,
    PaymentMethodType.REWARD_POINT,
  ].includes(type);
};

export const isDeferredPaymentType = (type: PaymentMethodType): boolean => {
  return type === PaymentMethodType.BNPL;
};

export const getProviderForPaymentType = (
  type: PaymentMethodType,
): PaymentProvider => {
  switch (type) {
    case PaymentMethodType.CARD:
    case PaymentMethodType.BANK_ACCOUNT:
      return PaymentProvider.TOSS;
    case PaymentMethodType.REWARD_POINT:
      return PaymentProvider.INTERNAL_POINT;
    case PaymentMethodType.BNPL:
      return PaymentProvider.HMS_BNPL;
    default:
      throw new Error(`지원하지 않는 결제 수단: ${type}`);
  }
};
