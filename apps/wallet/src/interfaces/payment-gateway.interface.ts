// interfaces/payment-gateway.interface.ts

/**
 * 표준 결제 게이트웨이 인터페이스 (test3.md 기준)
 * - 모든 결제 Provider가 동일한 인터페이스 구현
 * - 간단하고 직관적인 메서드명
 * - BNPL만 capture 단계 추가 지원
 */
export interface PaymentGateway {
  /**
   * 결제 처리 (즉시결제 또는 승인처리)
   * @param amount 결제 금액 (KRW)
   * @param currency 통화 (기본: KRW)
   * @param metadata 결제 메타데이터
   * @returns 결제 처리 결과
   */
  processPayment(
    amount: number,
    currency: string,
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult>;

  /**
   * 결제 환불
   * @param transactionId 원본 거래ID
   * @param amount 환불 금액 (KRW)
   * @returns 환불 처리 결과
   */
  refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
  ): Promise<RefundResult>;

  /**
   * 결제 확정 (BNPL 전용 - 선택적 구현)
   * @param authorizationIds 승인ID 목록
   * @returns 확정 처리 결과
   */
  capturePayment?(
    authorizationIds: string[],
    batchId?: string,
  ): Promise<CaptureResult>;

  /**
   * 결제 수단 등록 (정기결제용 - 선택적 구현)
   */
  registerPaymentMethod?(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult>;
}

// === 공통 타입 정의 ===

export interface PaymentMetadata {
  userId: string;
  sessionId: string;
  paymentMethodId: string;
  orderName?: string;
  hmsMemberId?: string; // HMS 전용
  bnplAccountId?: string; // BNPL 전용
  isRecurring?: boolean; // 정기결제 여부
  [key: string]: any;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string; // PG 거래ID
  authorizationId?: string; // 승인ID (BNPL용)
  captureId?: string; // 확정ID (즉시결제용)
  error?: string;
  metadata?: Record<string, any>;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  refundedAmount: number;
  pgTransactionId?: string; // PG 환불 거래 ID
  error?: string;
  metadata?: Record<string, any>;
}

export interface CaptureResult {
  success: boolean;
  failedIds: string[];
  metadata?: Record<string, any>;
}

export interface PaymentMethodRegistrationRequest {
  userId: string;
  memberName: string;
  phone: string;
  paymentNumber?: string; // 카드번호
  payerName?: string; // 카드 소유자명
  payerNumber?: string; // 납부자 번호 (HMS 전용, 10자리)
  validYear?: string; // 유효연도
  validMonth?: string; // 유효월
  creditLimit?: number; // BNPL 한도
  billingCycleDay?: number; // 결제일
  termsUrl?: string; // 약관 URL
}

export interface PaymentMethodRegistrationResult {
  success: boolean;
  paymentMethodId: string;
  hmsMemberId?: string; // HMS 전용
  error?: string;
  metadata?: Record<string, any>;
}
