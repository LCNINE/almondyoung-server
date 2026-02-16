// apps/wallet/src/providers/payment-policy.ts

import { PaymentType, ProviderType } from './payment-provider.interface';

/**
 * 결제 정책 테이블 - 회의 내용 반영
 *
 * CTO 요구사항:
 * - 주문 결제: 토스, 효성CMS, 배치CMS 모두 허용
 * - 나중 결제 정산: 배치CMS만 허용 (수수료 이익 없음)
 * - 멤버십 결제: 배치CMS만 허용 (정기 결제 특성)
 *
 * 비즈니스 판단에 의한 정책이므로 테이블로 분리하여 관리
 */
export const PAYMENT_POLICY_TABLE = {
  [PaymentType.ORDER]: [
    ProviderType.TOSS,
    ProviderType.HMS_CARD,
    ProviderType.HMS_BNPL,
  ],
  [PaymentType.BNPL_CAPTURE]: [
    ProviderType.HMS_BNPL, // CMS만 허용 - 토스는 수수료 이익 없음
  ],
  [PaymentType.MEMBERSHIP_FEE]: [
    ProviderType.HMS_CARD, // 멤버십 정기 결제는 HMS_CARD만 허용
  ],
} as const;

/**
 * 결제 정책 관리 클래스
 */
export class PaymentPolicy {
  /**
   * 결제 타입에 허용된 Provider 목록 반환
   */
  static getAllowedProviders(paymentType: PaymentType): ProviderType[] {
    const providers = PAYMENT_POLICY_TABLE[paymentType];
    if (!providers) {
      throw new Error(`지원하지 않는 결제 타입: ${paymentType}`);
    }
    return [...providers]; // 복사본 반환
  }

  /**
   * 결제 타입과 Provider 조합 유효성 검증
   */
  static validateProviderForPaymentType(
    paymentType: PaymentType,
    providerType: ProviderType,
  ): boolean {
    const allowedProviders = this.getAllowedProviders(paymentType);
    return allowedProviders.includes(providerType);
  }

  /**
   * 허용되지 않은 조합에 대한 에러 메시지 생성
   */
  static getValidationErrorMessage(
    paymentType: PaymentType,
    providerType: ProviderType,
  ): string {
    const allowedProviders = this.getAllowedProviders(paymentType);
    return (
      `${paymentType} 결제는 ${providerType} Provider를 사용할 수 없습니다. ` +
      `허용된 Provider: ${allowedProviders.join(', ')}`
    );
  }

  /**
   * 전체 정책 테이블 반환 (읽기 전용)
   */
  static getPolicyTable(): Record<PaymentType, readonly ProviderType[]> {
    return PAYMENT_POLICY_TABLE;
  }
}

/**
 * 결제 정책 에러 클래스
 */
export class PaymentPolicyError extends Error {
  constructor(
    message: string,
    public readonly paymentType: PaymentType,
    public readonly providerType: ProviderType,
  ) {
    super(message);
    this.name = 'PaymentPolicyError';
  }
}
