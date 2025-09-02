// ports/deferred-payment.port.ts
/**
 * 후불결제 어댑터 포트 (BNPL 전용)
 * - 승인과 확정이 분리됨
 * - 승인: 즉시, 확정: 스케줄러가 나중에 처리
 */

export interface DeferredPaymentAdapter {
  /**
   * 결제 승인 (내부적으로만, 실제 출금 X)
   */
  authorize(
    request: DeferredAuthorizeRequest,
  ): Promise<DeferredAuthorizeResponse>;

  /**
   * 결제 확정 (실제 출금 실행)
   */
  capture(request: DeferredCaptureRequest): Promise<DeferredCaptureResponse>;

  /**
   * 환불 처리
   */
  refund(request: DeferredRefundRequest): Promise<DeferredRefundResponse>;
}

export interface DeferredAuthorizeRequest {
  paymentMethodId: string;
  amount: number;
  currency: string;
  orderName?: string;
  metadata?: Record<string, any>;
}

export interface DeferredAuthorizeResponse {
  success: boolean;
  authorizationId: string; // 내부 승인 ID
  error?: string;
  metadata?: {
    remainingLimit?: number;
    [key: string]: any;
  };
}

export interface DeferredCaptureRequest {
  authorizationId: string;
  amount: number;
  metadata?: Record<string, any>;
}

export interface DeferredCaptureResponse {
  success: boolean;
  transactionId: string; // 외부 시스템 트랜잭션 ID
  error?: string;
  metadata?: Record<string, any>;
}

export interface DeferredRefundRequest {
  transactionId: string;
  amount: number;
  reason?: string;
}

export interface DeferredRefundResponse {
  success: boolean;
  refundId: string;
  error?: string;
  metadata?: Record<string, any>;
}
