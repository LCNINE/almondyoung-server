// 아몬드 결제 시스템과의 연동을 위한 타입 정의

export interface AlmondPaymentOptions {
  apiKey: string; // 기존 서비스 엔드포인트 URL
  // API 키나 timeout 등은 우리 시스템에서 불필요
}

export interface PaymentDetailDto {
  methodType: 'BNPL' | 'REWARD_POINT';
  amount: number;
  paymentMethodId?: string;
}

export interface ProcessPaymentDto {
  invoiceId: string;
  invoiceSessionId: string;
  payments: PaymentDetailDto[];
  paymentMethodId?: string; // 하위 호환성
}

// 새로운 API 구조 타입들
export interface AuthorizePaymentDto {
  invoiceId: string;
  paymentMethodId?: string;
  pointAmount?: number;
  paymentMethods?: Array<{
    type: 'BNPL' | 'REWARD_POINT' | 'CARD';
    paymentMethodId?: string;
    amount?: number;
  }>;
}

export interface CapturePaymentDto {
  paymentEventId: string;
  amount?: number;
  pgTransactionId?: string;
}

export interface PaymentAuthorizationResult {
  entityId: string;
  timestamp: string;
  entityType: string;
  entityBody: {
    paymentEventId: string;
    paymentStatus: string;
    userId: string;
    processedPayments: any[];
    totalAmount: number;
  };
}

export interface PaymentCaptureResult {
  entityId: string;
  timestamp: string;
  entityType: string;
  entityBody: {
    paymentEventId: string;
    paymentStatus: string;
    capturedAmount: number;
  };
}

// 기존 응답 구조 (하위 호환성)
export interface PaymentResponse {
  success: boolean;
  paymentEventId: string;
  paymentStatus: string;
  message?: string;
}

export interface PaymentStatusResponse {
  status: 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  paymentEventId: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRequest {
  paymentEventId: string;
  refundAmount: number;
  reason: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  refundAmount: number;
  refundedAt: string;
}

export interface WebhookData {
  eventType: 'payment.completed' | 'payment.failed' | 'payment.refunded';
  paymentEventId: string;
  status: string;
  timestamp: string;
  data?: any;
}
