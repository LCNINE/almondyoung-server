// ports/payment-adapter.port.ts
/**
 * 결제 실행을 위한 어댑터 인터페이스
 * - 결제수단별로 authorize, capture, refund 처리
 * - 각 결제수단(카드, BNPL, 포인트)마다 구현체 제공
 */

export interface PaymentAdapter {
  /**
   * 결제 승인 (Authorization)
   * - 카드: PG사 결제 승인
   * - BNPL: HMS 출금 요청
   * - 포인트: 즉시 차감
   */
  authorize(request: AuthorizeRequest): Promise<AuthorizeResponse>;

  /**
   * 결제 확정 (Capture)
   * - 카드: PG사 결제 확정
   * - BNPL: 내부 상태 변경만 (HMS는 승인=확정)
   * - 포인트: 승인과 동시에 처리됨
   */
  capture(request: CaptureRequest): Promise<CaptureResponse>;

  /**
   * 결제 환불
   * - 카드: PG사 환불 요청
   * - BNPL: HMS 환불 기록
   * - 포인트: 포인트 복원
   */
  refund(request: RefundRequest): Promise<RefundResponse>;
}

export interface AuthorizeRequest {
  paymentMethodId: string;
  amount: number;
  currency: string;
  orderName?: string;
  metadata?: Record<string, any>;
}

export interface AuthorizeResponse {
  success: boolean;
  pgTransactionId?: string; // 외부 시스템 트랜잭션 ID
  error?: string;
  metadata?: Record<string, any>;
}

export interface CaptureRequest {
  pgTransactionId: string;
  amount: number;
  metadata?: Record<string, any>;
}

export interface CaptureResponse {
  success: boolean;
  pgTransactionId: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface RefundRequest {
  pgTransactionId: string;
  amount: number;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface RefundResponse {
  success: boolean;
  pgTransactionId: string; // 환불 트랜잭션 ID
  error?: string;
  metadata?: Record<string, any>;
}
