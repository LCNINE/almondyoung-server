// payment-method/port/payment-method.port.ts
import { PaymentResponseDto } from 'hms-api-wrapper';
export interface PaymentMethodPort {
  /**
   * 결제 요청
   */
  charge(request: ChargeRequest): Promise<ChargeResult | ErrorResult>;

  /**
   * 환불 요청
   */
  refund(request: RefundRequest): Promise<RefundResult>;

  /**
   * 결제 상태 조회
   */
  getPaymentStatus(transactionId: string): Promise<PaymentStatusResult>;

  /**
   * 결제수단 검증 (PG 토큰 유효성 등)
   */
  verify?(providerMethodId: string): Promise<boolean>;

  /**
   * 결제수단 비활성화
   */
  deactivate?(providerMethodId: string): Promise<void>;
}

export interface ChargeRequest {
  invoiceId: string;
  amount: number;
  paymentDate: string;
  memberId: string;
}

export interface ChargeResult {
  success: true;
  transactionId: string;
  status: 'AUTHORIZED' | 'FAILED'; // MVP 기준 단순화
  rawResponse: PaymentResponseDto;
}

export interface ErrorResult {
  success: false;
  transactionId: string;
  status: 'FAILED';
  rawResponse: any;
  error: string;
}

export interface RefundRequest {
  transactionId: string;
  amount: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface RefundResult {
  refundId: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILURE';
  message?: string;
  rawResponse: any;
}

export interface PaymentStatusResult {
  transactionId: string;
  status: 'REQUESTED' | 'CAPTURED' | 'CANCELLED' | 'FAILED';
  amount: number;
  capturedAt?: Date;
  rawResponse: any;
}
