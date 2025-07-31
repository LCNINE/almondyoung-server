// === 표준 응답 규격 ===

// 성공 응답 규격
export interface StandardSuccessResponse<T = any> {
  entityId: string;        // 고유 ID
  timestamp: string;       // 생성 시간 (ISO 8601)
  entityType: string;      // 이벤트 타입
  entityBody: T;           // 이벤트 내용
}

// 에러 응답 규격
export interface StandardErrorResponse {
  code: string;            // 에러 코드
  message: string;         // 에러 메시지
}

// API v2 에러 객체
export interface ApiV2ErrorResponse {
  version: string;         // "2022-11-16"
  traceId: string;         // 추적 ID
  error: StandardErrorResponse;
}

// === 결제 관련 타입 정의 ===

// 결제 승인 요청 타입
export interface AuthorizePaymentDto {
  invoiceId: string;
  invoiceSessionId: string;
  payments: Array<{
    methodType: 'BNPL' | 'REWARD_POINT';
    amount: number;
    paymentMethodId?: string;
  }>;
  paymentMethodId?: string; // 하위 호환성
}

// 결제 캡처 요청 타입
export interface CapturePaymentDto {
  paymentEventId: string;
  amount?: number; // 부분 캡처 지원 (선택사항)
  pgTransactionId?: string; // 추가 필요
}

// 결제 승인 응답 타입
export type PaymentAuthorizationResult = StandardSuccessResponse<{
  paymentEventId: string;
  paymentStatus: string;
  userId: string;
  processedPayments: Array<{
    methodType: string;
    amount: number;
    paymentMethodId?: string;
    status: string;
  }>;
  totalAmount: number;
}>;

// 결제 캡처 응답 타입
export type PaymentCaptureResult = StandardSuccessResponse<{
  paymentEventId: string;
  paymentStatus: string;
  capturedAmount: number;
}>;