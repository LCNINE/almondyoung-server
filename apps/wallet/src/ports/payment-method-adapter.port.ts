// ports/payment-method-adapter.port.ts
/**
 * 결제수단별 외부 시스템 연동 어댑터 인터페이스
 * - 카드: PG사 토큰화
 * - 포인트: 즉시 등록 (외부 연동 불필요)
 * - BNPL: 별도 컨트롤러에서 처리
 */

export interface PaymentMethodAdapterPort {
  /**
   * 결제수단 등록 (외부 시스템 토큰화 등)
   */
  register(request: RegisterMethodRequest): Promise<RegisterMethodResult>;

  /**
   * 결제수단 검증/활성화 상태 확인
   */
  verify?(): Promise<VerificationResult>;

  /**
   * 결제수단 비활성화 (외부 시스템 정리)
   */
  deactivate?(methodId: string): Promise<DeactivationResult>;
}

export interface RegisterMethodRequest {
  userId: string;
  methodType: 'CARD' | 'REWARD_POINT';
  methodName: string;
  cardInfo?: {
    cardNumber: string;
    cardHolderName: string;
    expiryDate: string; // MM/YY 형식
    billingKey?: string;
  };
}

export interface RegisterMethodResult {
  success: boolean;
  pgToken?: string; // PG사 고객 토큰
  billingKey?: string; // 빌링키
  maskedCardNumber?: string; // 마스킹된 카드번호
  error?: string;
  metadata?: Record<string, any>;
}

export interface VerificationResult {
  isValid: boolean;
  message?: string;
  metadata?: Record<string, any>;
}

export interface DeactivationResult {
  success: boolean;
  message?: string;
}
