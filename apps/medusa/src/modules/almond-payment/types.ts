// 아몬드 결제 시스템과의 연동을 위한 타입 정의
// --- Helper Functions and Types --- 에 추가

import { PaymentProviderContext } from "@medusajs/framework/types" // 상단 import에 추가

/**
 * API 요청을 위한 표준 헤더를 생성합니다.
 * 멱등성 키가 존재할 경우, 헤더에 포함시킵니다.
 * @param context - Medusa의 PaymentProviderContext
 * @returns fetch API에 사용될 Headers 객체
 */
export function createApiHeaders(context?: PaymentProviderContext): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-publishable-api-key': 'pk_f44ee6fc7ea5d0828cab0fa4b15e4caf986393942f6d5f66079a9389b7707549'
  };

  if (context?.idempotency_key) {
    headers['Idempotency-Key'] = context.idempotency_key;
  }

  return headers;
}
export interface AlmondPaymentOptions {
  apiKey: string;           // 기존 서비스 API 키
  endpoint: string;         // 기존 서비스 엔드포인트 URL
  timeout?: number;         // HTTP 요청 타임아웃 (기본: 30초)
  retryAttempts?: number;   // 재시도 횟수 (기본: 3회)
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
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

// Stripe 패턴 적용: 오류 처리 타입들
export type AlmondIndeterminateState = {
  indeterminate_due_to: string;
};

export type AlmondErrorData = PaymentResponse | AlmondIndeterminateState;

export type HandledErrorType =
  | { retry: true }
  | { retry: false; data: AlmondErrorData };

// 데이터 변환 인터페이스
export interface MedusaToServiceMapping {
  sessionId: string;        // data.session_id → 세션 식별자
  invoiceId: string;        // session_id 기반으로 생성된 invoiceId
  userId?: string;          // context에서 추출된 사용자 ID
  amount: number;           // amount → amount
  currency: string;         // currency_code → currency
  payments: Array<{         // 혼합 결제 지원
    methodType: string;     // PaymentMethodType
    paymentMethodId?: string;
    amount: number;
  }>;
}

export interface ServiceToMedusaMapping {
  paymentEventId: string;   // PaymentEvent.id → payment_id
  status: string;           // FINANCIAL_TRANSACTION_STATUS → PaymentSessionStatus
  amount: number;           // amount → amount
  sessionId: string;        // 원본 session_id 보존
  metadata?: Record<string, any>; // 추가 정보
}
