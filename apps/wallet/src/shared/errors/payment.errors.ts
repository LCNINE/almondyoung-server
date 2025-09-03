/**
 * 비즈니스 예외 클래스들
 * - HTTP와 무관한 순수 비즈니스 예외
 * - Service 레이어에서만 사용
 * - Controller에서 HTTP 상태 코드로 매핑
 */

export class PaymentBusinessError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * 404 에러들
 */
export class PaymentSessionNotFoundError extends PaymentBusinessError {
  constructor(sessionId?: string) {
    super(
      sessionId
        ? `결제 세션을 찾을 수 없습니다: ${sessionId}`
        : '결제 세션을 찾을 수 없습니다',
    );
  }
}

export class PaymentMethodNotFoundError extends PaymentBusinessError {
  constructor(paymentMethodId?: string) {
    super(
      paymentMethodId
        ? `결제수단을 찾을 수 없습니다: ${paymentMethodId}`
        : '결제수단을 찾을 수 없습니다',
    );
  }
}

export class PaymentEventNotFoundError extends PaymentBusinessError {
  constructor(authorizationId?: string) {
    super(
      authorizationId
        ? `결제 이벤트를 찾을 수 없습니다: ${authorizationId}`
        : '결제 이벤트를 찾을 수 없습니다',
    );
  }
}

/**
 * 400 에러들 (비즈니스 규칙 위반)
 */
export class InvalidPaymentAmountError extends PaymentBusinessError {
  constructor(requested: number, expected: number) {
    super(`결제 금액이 일치하지 않습니다: 요청=${requested}, 세션=${expected}`);
  }
}

export class PaymentSessionAlreadyProcessedError extends PaymentBusinessError {
  constructor(status: string) {
    super(`이미 처리된 결제 세션입니다: ${status}`);
  }
}

export class InactivePaymentMethodError extends PaymentBusinessError {
  constructor(paymentMethodId: string) {
    super(`비활성화된 결제수단입니다: ${paymentMethodId}`);
  }
}

export class InsufficientPointsError extends PaymentBusinessError {
  constructor(requested: number, available: number) {
    super(`포인트가 부족합니다: 요청=${requested}, 잔액=${available}`);
  }
}

export class UnsupportedPaymentMethodError extends PaymentBusinessError {
  constructor(methodType: string) {
    super(`지원하지 않는 결제수단입니다: ${methodType}`);
  }
}

/**
 * 결제 처리 실패
 */
export class ImmediatePaymentFailedError extends PaymentBusinessError {
  constructor(reason: string) {
    super(`즉시결제 실패: ${reason}`);
  }
}

export class DeferredPaymentAuthorizationFailedError extends PaymentBusinessError {
  constructor(reason: string) {
    super(`후불결제 승인 실패: ${reason}`);
  }
}

export class DeferredPaymentCaptureFailedError extends PaymentBusinessError {
  constructor(reason: string) {
    super(`후불결제 확정 실패: ${reason}`);
  }
}

/**
 * BNPL 관련 에러들
 */
export class BnplMemberNotFoundError extends PaymentBusinessError {
  constructor(memberId?: string) {
    super(
      memberId
        ? `BNPL 회원을 찾을 수 없습니다: ${memberId}`
        : 'BNPL 회원을 찾을 수 없습니다',
    );
  }
}

export class BnplMemberAlreadyExistsError extends PaymentBusinessError {
  constructor(userId: string) {
    super(`이미 BNPL 계정이 존재합니다: ${userId}`);
  }
}

export class BnplAccountNotFoundError extends PaymentBusinessError {
  constructor(userId?: string) {
    super(
      userId
        ? `BNPL 계정을 찾을 수 없습니다: ${userId}`
        : 'BNPL 계정을 찾을 수 없습니다',
    );
  }
}

export class HmsMemberCreationFailedError extends PaymentBusinessError {
  constructor(reason?: string) {
    super(`HMS 회원 등록에 실패했습니다${reason ? `: ${reason}` : ''}`);
  }
}

/**
 * 환불 관련 에러들
 */
export class RefundNotFoundError extends PaymentBusinessError {
  constructor(message?: string) {
    super(message || '환불을 찾을 수 없습니다');
  }
}

export class RefundAlreadyProcessedError extends PaymentBusinessError {
  constructor(message?: string) {
    super(message || '이미 처리된 환불입니다');
  }
}

export class RefundAmountExceedsLimitError extends PaymentBusinessError {
  constructor(message?: string) {
    super(message || '환불 요청 금액이 한도를 초과합니다');
  }
}

export class RefundExecutionFailedError extends PaymentBusinessError {
  constructor(message?: string) {
    super(message || '환불 실행에 실패했습니다');
  }
}
