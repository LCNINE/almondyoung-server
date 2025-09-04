// shared/errors/payment.errors.ts

/**
 * 결제 도메인 공통 에러
 * - code: 클라이언트에 내려주는 식별자
 */
export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

/**
 * 404 계열 - 리소스를 찾을 수 없음
 */
export class PaymentNotFoundError extends PaymentError {
  constructor(message = '결제 리소스를 찾을 수 없습니다') {
    super(message, 'NOT_FOUND');
  }
}

/**
 * 400 계열 - 잘못된 데이터 / 규칙 위반
 */
export class PaymentValidationError extends PaymentError {
  constructor(message = '결제 데이터가 올바르지 않습니다') {
    super(message, 'VALIDATION_FAILED');
  }
}

/**
 * 400 계열 - 결제 처리 실패
 */
export class PaymentProcessingError extends PaymentError {
  constructor(message = '결제 처리 중 오류가 발생했습니다') {
    super(message, 'PROCESSING_FAILED');
  }
}
