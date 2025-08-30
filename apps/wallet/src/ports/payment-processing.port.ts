export interface ChargeRequest {
  invoiceId: string;
  amount: number;
  paymentDate: string;
  memberId: string;
}

export interface ChargeResult {
  success: boolean;
  transactionId: string;
  status: 'AUTHORIZED' | 'FAILED';
  rawResponse: any;
  gatewayId?: string;
}

export interface ErrorResult {
  success: false;
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

export interface PaymentProcessingPort {
  charge(request: ChargeRequest): Promise<ChargeResult | ErrorResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  getPaymentStatus(transactionId: string): Promise<PaymentStatusResult>;
}
