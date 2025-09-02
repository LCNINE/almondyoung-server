// shared/dtos/payments/payment-response.dto.ts
/**
 * 결제 응답 관련 DTO들
 */

export interface ApprovePaymentResponse {
  success: boolean;
  paymentId: string;
  sessionId: string;
  amount: number;
  currency: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
  paymentEvents: PaymentEventResponse[];
  metadata?: Record<string, any>;
  error?: string;
}

export interface PaymentEventResponse {
  paymentMethodId: string;
  methodType: 'CARD' | 'BNPL' | 'REWARD_POINT';
  amount: number;
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
  pgTransactionId?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface CapturePaymentResponse {
  success: boolean;
  paymentId: string;
  amount: number;
  status: 'CAPTURED' | 'FAILED';
  capturedAt: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface AuthorizePaymentResponse {
  success: boolean;
  paymentId: string;
  amount: number;
  status: 'AUTHORIZED' | 'FAILED';
  authorizedAt: string;
  error?: string;
  metadata?: Record<string, any>;
}
