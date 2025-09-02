// ports/immediate-payment.port.ts
/**
 * 즉시결제 어댑터 포트
 * - 카드, 계좌이체 등 즉시 확정되는 결제수단
 * - authorize + capture가 동시에 처리됨
 */

export interface ImmediatePaymentAdapter {
  /**
   * 즉시 결제 처리 (승인+확정 동시)
   */
  process(request: ImmediatePaymentRequest): Promise<ImmediatePaymentResponse>;

  /**
   * 환불 처리
   */
  refund(request: RefundRequest): Promise<RefundResponse>;
}

export interface ImmediatePaymentRequest {
  paymentMethodId: string;
  amount: number;
  currency: string;
  orderName?: string;
  metadata?: Record<string, any>;
}

export interface ImmediatePaymentResponse {
  success: boolean;
  transactionId: string; // PG사 트랜잭션 ID
  error?: string;
  metadata?: Record<string, any>;
}

export interface RefundRequest {
  transactionId: string;
  amount: number;
  reason?: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  error?: string;
  metadata?: Record<string, any>;
}
