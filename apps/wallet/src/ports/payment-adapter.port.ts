// ports/payment-adapter.port.ts
/**
 * 통합 결제 어댑터 인터페이스
 *
 * 모든 결제수단(카드, BNPL, 포인트)이 이 인터페이스를 구현하여
 * 일관된 방식으로 결제 처리가 가능합니다.
 *
 * 즉시결제 vs 후불결제 처리:
 * - 즉시결제(카드): authorize에서 승인+확정 동시 처리, capture는 no-op
 * - 후불결제(BNPL): authorize는 승인만, capture에서 실제 출금
 * - 포인트: authorize에서 즉시 차감, capture는 no-op
 */

export interface PaymentAdapter {
  /**
   * 결제 승인 (Authorization)
   *
   * 결제수단별 동작:
   * - 카드: PG사에서 승인+확정 동시 처리
   * - BNPL: 내부 한도 차감 (실제 출금 X)
   * - 포인트: 즉시 포인트 차감
   */
  authorize(request: AuthorizeRequest): Promise<AuthorizeResponse>;

  /**
   * 결제 확정 (Capture)
   *
   * 결제수단별 동작:
   * - 카드: 이미 확정되었으므로 no-op (success: true 반환)
   * - BNPL: 실제 HMS 출금 요청 실행
   * - 포인트: 이미 처리되었으므로 no-op (success: true 반환)
   */
  capture(request: CaptureRequest): Promise<CaptureResponse>;

  /**
   * 결제 환불
   *
   * 결제수단별 동작:
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
  pgTransactionId?: string; // 외부 시스템 트랜잭션 ID (카드: PG ID, BNPL: 내부 승인 ID, 포인트: 포인트 트랜잭션 ID)
  authorizationId?: string; // 내부 승인 ID (후불결제용)
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
