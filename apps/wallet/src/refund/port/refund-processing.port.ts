// 환불 요청 페이로드
export interface RefundRequestPayload {
  refundId: string;
  paymentEventId: string;
  refundAccountId: string;
  amount: number;
  reason: string;
  userId: string;
}

// 성공 응답 객체
interface RefundSuccessResult {
  success: true; // 성공 여부 명시
  refundId: string;
  status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  message?: string;
  pgTransactionId?: string;
  refundedAt?: string;
  refundAmount?: number;
}

// 에러 상세 객체
export interface RefundError {
  code?: string;
  message: string;
  detail?: string;
}

// 실패 응답 객체
interface RefundFailureResult {
  success: false; // 실패 여부 명시
  refundId: string;
  status: 'FAILED';
  message?: string;
  error: RefundError; // 실패 시 error 필수
}

// 성공 또는 실패 결과 타입
export type RefundResult = RefundSuccessResult | RefundFailureResult;

/**
 * 환불 처리 추상 포트 (인터페이스)
 * 다양한 환불 처리 방식을 추상화
 */
export abstract class RefundProcessingPort {
  /**
   * 환불 처리 메서드
   * @param payload 환불 요청 데이터
   * @returns 환불 처리 성공 또는 실패 결과를 Promise로 반환
   */
  abstract processRefund(payload: RefundRequestPayload): Promise<RefundResult>;
}
