/**
 * 구독 결제 전용 에러 타입 및 클래스
 * 
 * 요구사항:
 * - 5.1: HMS 회원 상태별 구체적인 에러 메시지 정의
 * - 5.2: 재시도 가능 여부 및 재시도 권장 시간 포함
 * - 5.4: 외부 서비스가 활용할 수 있는 상세한 에러 정보 제공
 */

/**
 * 구독 결제 에러 타입 열거형
 */
export enum RecurringPaymentErrorType {
  // 결제수단 관련 에러
  PAYMENT_METHOD_NOT_FOUND = 'PAYMENT_METHOD_NOT_FOUND',
  PAYMENT_METHOD_INACTIVE = 'PAYMENT_METHOD_INACTIVE',
  PAYMENT_METHOD_INVALID_PURPOSE = 'PAYMENT_METHOD_INVALID_PURPOSE',
  PAYMENT_METHOD_UNAUTHORIZED = 'PAYMENT_METHOD_UNAUTHORIZED',
  
  // HMS 회원 상태 관련 에러
  HMS_MEMBER_NOT_FOUND = 'HMS_MEMBER_NOT_FOUND',
  HMS_MEMBER_PENDING = 'HMS_MEMBER_PENDING',
  HMS_MEMBER_WAITING = 'HMS_MEMBER_WAITING',
  HMS_MEMBER_FAILED = 'HMS_MEMBER_FAILED',
  HMS_MEMBER_SUSPENDED = 'HMS_MEMBER_SUSPENDED',
  HMS_API_ERROR = 'HMS_API_ERROR',
  
  // BNPL 관련 에러
  BNPL_ACCOUNT_NOT_FOUND = 'BNPL_ACCOUNT_NOT_FOUND',
  BNPL_INSUFFICIENT_CREDIT = 'BNPL_INSUFFICIENT_CREDIT',
  BNPL_ACCOUNT_SUSPENDED = 'BNPL_ACCOUNT_SUSPENDED',
  
  // 결제 처리 관련 에러
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  PAYMENT_DECLINED = 'PAYMENT_DECLINED',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  GATEWAY_ERROR = 'GATEWAY_ERROR',
  
  // 시스템 에러
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  CONCURRENCY_CONFLICT = 'CONCURRENCY_CONFLICT',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  
  // 비즈니스 로직 에러
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  SUBSCRIPTION_TYPE_INVALID = 'SUBSCRIPTION_TYPE_INVALID',
}

/**
 * 구독 결제 에러 상세 정보 인터페이스
 */
export interface RecurringPaymentErrorDetails {
  /** 에러 발생 원인에 대한 상세 정보 */
  reason?: string;
  /** HMS 회원 상태 (HMS 관련 에러인 경우) */
  hmsStatus?: string;
  /** HMS 회원 ID */
  hmsMemberId?: string;
  /** 결제수단 ID */
  paymentMethodId?: string;
  /** 결제수단 타입 */
  methodType?: string;
  /** 현재 결제수단 용도 */
  currentPurpose?: string;
  /** 허용되는 결제수단 용도 목록 */
  allowedPurposes?: string[];
  /** 사용 가능한 신용 한도 (BNPL인 경우) */
  availableCredit?: number;
  /** 필요한 금액 */
  requiredAmount?: number;
  /** 게이트웨이 응답 코드 */
  gatewayCode?: string;
  /** 게이트웨이 에러 메시지 */
  gatewayMessage?: string;
  /** 에러 발생 시각 */
  occurredAt?: string;
  /** 추가 컨텍스트 정보 */
  context?: Record<string, any>;
}

/**
 * 구독 결제 에러 클래스
 */
export class RecurringPaymentError extends Error {
  constructor(
    public readonly type: RecurringPaymentErrorType,
    public readonly message: string,
    public readonly retryable: boolean = false,
    public readonly retryAfterSeconds?: number,
    public readonly details?: RecurringPaymentErrorDetails,
    public readonly httpStatusCode: number = 400
  ) {
    super(message);
    this.name = 'RecurringPaymentError';
  }

  /**
   * 에러를 JSON 형태로 직렬화
   */
  toJSON() {
    return {
      type: this.type,
      message: this.message,
      retryable: this.retryable,
      retryAfterSeconds: this.retryAfterSeconds,
      details: this.details,
      httpStatusCode: this.httpStatusCode,
    };
  }
}

/**
 * 구독 결제 에러 팩토리 클래스
 * HMS 상태별, 에러 타입별로 적절한 에러 객체를 생성합니다.
 */
export class RecurringPaymentErrorFactory {
  
  /**
   * HMS 회원 상태별 에러 생성
   */
  static createHmsStatusError(
    hmsStatus: string,
    hmsMemberId?: string,
    paymentMethodId?: string
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      reason: 'INVALID_HMS_STATUS',
      hmsStatus,
      hmsMemberId,
      paymentMethodId,
      occurredAt: new Date().toISOString(),
    };

    switch (hmsStatus) {
      case '신청중':
        return new RecurringPaymentError(
          RecurringPaymentErrorType.HMS_MEMBER_PENDING,
          '회원 등록이 진행중입니다. 잠시 후에 시도해주세요.',
          true, // 재시도 가능
          300, // 5분 후 재시도 권장
          details,
          409 // Conflict
        );

      case '신청대기':
        return new RecurringPaymentError(
          RecurringPaymentErrorType.HMS_MEMBER_WAITING,
          '등록 신청이 대기중인 회원입니다. 관리자 승인 후 이용 가능합니다.',
          true, // 재시도 가능
          1800, // 30분 후 재시도 권장
          details,
          409 // Conflict
        );

      case '신청실패':
        return new RecurringPaymentError(
          RecurringPaymentErrorType.HMS_MEMBER_FAILED,
          '등록에 실패한 회원입니다. 결제 정보를 다시 확인하고 재등록해주세요.',
          false, // 재시도 불가능 - 재등록 필요
          undefined,
          details,
          422 // Unprocessable Entity
        );

      case '정지':
      case '해지':
        return new RecurringPaymentError(
          RecurringPaymentErrorType.HMS_MEMBER_SUSPENDED,
          '정지 또는 해지된 회원입니다. 고객센터에 문의해주세요.',
          false, // 재시도 불가능
          undefined,
          details,
          403 // Forbidden
        );

      default:
        return new RecurringPaymentError(
          RecurringPaymentErrorType.HMS_MEMBER_NOT_FOUND,
          `회원의 등록 상태를 알 수 없습니다: ${hmsStatus}`,
          true, // 재시도 가능
          60, // 1분 후 재시도 권장
          details,
          422 // Unprocessable Entity
        );
    }
  }

  /**
   * 결제수단 관련 에러 생성
   */
  static createPaymentMethodError(
    errorType: RecurringPaymentErrorType,
    paymentMethodId: string,
    additionalDetails?: Partial<RecurringPaymentErrorDetails>
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      paymentMethodId,
      occurredAt: new Date().toISOString(),
      ...additionalDetails,
    };

    switch (errorType) {
      case RecurringPaymentErrorType.PAYMENT_METHOD_NOT_FOUND:
        return new RecurringPaymentError(
          errorType,
          '등록된 결제수단을 찾을 수 없습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          404 // Not Found
        );

      case RecurringPaymentErrorType.PAYMENT_METHOD_INACTIVE:
        return new RecurringPaymentError(
          errorType,
          '비활성화된 결제수단입니다. 결제수단을 다시 등록해주세요.',
          false, // 재시도 불가능
          undefined,
          details,
          422 // Unprocessable Entity
        );

      case RecurringPaymentErrorType.PAYMENT_METHOD_INVALID_PURPOSE:
        return new RecurringPaymentError(
          errorType,
          '구독 결제가 허용되지 않은 결제수단입니다. 구독 전용 결제수단을 등록해주세요.',
          false, // 재시도 불가능
          undefined,
          {
            ...details,
            reason: 'INVALID_PAYMENT_PURPOSE',
            allowedPurposes: ['SUBSCRIPTION', 'BOTH'],
          },
          422 // Unprocessable Entity
        );

      case RecurringPaymentErrorType.PAYMENT_METHOD_UNAUTHORIZED:
        return new RecurringPaymentError(
          errorType,
          '결제수단에 대한 권한이 없습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          403 // Forbidden
        );

      default:
        return new RecurringPaymentError(
          errorType,
          '결제수단 처리 중 오류가 발생했습니다.',
          true, // 재시도 가능
          60, // 1분 후 재시도 권장
          details,
          500 // Internal Server Error
        );
    }
  }

  /**
   * BNPL 관련 에러 생성
   */
  static createBnplError(
    errorType: RecurringPaymentErrorType,
    paymentMethodId: string,
    availableCredit?: number,
    requiredAmount?: number,
    additionalDetails?: Partial<RecurringPaymentErrorDetails>
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      paymentMethodId,
      availableCredit,
      requiredAmount,
      occurredAt: new Date().toISOString(),
      ...additionalDetails,
    };

    switch (errorType) {
      case RecurringPaymentErrorType.BNPL_ACCOUNT_NOT_FOUND:
        return new RecurringPaymentError(
          errorType,
          'BNPL 계정 정보를 찾을 수 없습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          404 // Not Found
        );

      case RecurringPaymentErrorType.BNPL_INSUFFICIENT_CREDIT:
        const creditMessage = availableCredit && requiredAmount
          ? `BNPL 계정의 사용 가능한 한도가 부족합니다. (필요: ${requiredAmount.toLocaleString()}원, 가능: ${availableCredit.toLocaleString()}원)`
          : 'BNPL 계정의 사용 가능한 한도가 부족합니다.';
        
        return new RecurringPaymentError(
          errorType,
          creditMessage,
          true, // 재시도 가능 (한도 회복 후)
          3600, // 1시간 후 재시도 권장
          details,
          422 // Unprocessable Entity
        );

      case RecurringPaymentErrorType.BNPL_ACCOUNT_SUSPENDED:
        return new RecurringPaymentError(
          errorType,
          'BNPL 계정이 정지되었습니다. 고객센터에 문의해주세요.',
          false, // 재시도 불가능
          undefined,
          details,
          403 // Forbidden
        );

      default:
        return new RecurringPaymentError(
          errorType,
          'BNPL 계정 처리 중 오류가 발생했습니다.',
          true, // 재시도 가능
          300, // 5분 후 재시도 권장
          details,
          500 // Internal Server Error
        );
    }
  }

  /**
   * 게이트웨이 관련 에러 생성
   */
  static createGatewayError(
    errorType: RecurringPaymentErrorType,
    gatewayCode?: string,
    gatewayMessage?: string,
    additionalDetails?: Partial<RecurringPaymentErrorDetails>
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      gatewayCode,
      gatewayMessage,
      occurredAt: new Date().toISOString(),
      ...additionalDetails,
    };

    switch (errorType) {
      case RecurringPaymentErrorType.INSUFFICIENT_FUNDS:
        return new RecurringPaymentError(
          errorType,
          '잔액이 부족합니다. 계좌 잔액을 확인해주세요.',
          true, // 재시도 가능
          1800, // 30분 후 재시도 권장
          details,
          422 // Unprocessable Entity
        );

      case RecurringPaymentErrorType.PAYMENT_DECLINED:
        return new RecurringPaymentError(
          errorType,
          '결제가 거절되었습니다. 카드사 또는 은행에 문의해주세요.',
          true, // 재시도 가능
          3600, // 1시간 후 재시도 권장
          details,
          422 // Unprocessable Entity
        );

      case RecurringPaymentErrorType.GATEWAY_TIMEOUT:
        return new RecurringPaymentError(
          errorType,
          '결제 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          300, // 5분 후 재시도 권장
          details,
          504 // Gateway Timeout
        );

      case RecurringPaymentErrorType.GATEWAY_ERROR:
        return new RecurringPaymentError(
          errorType,
          gatewayMessage || '결제 게이트웨이 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          600, // 10분 후 재시도 권장
          details,
          502 // Bad Gateway
        );

      default:
        return new RecurringPaymentError(
          errorType,
          '결제 처리 중 오류가 발생했습니다.',
          true, // 재시도 가능
          300, // 5분 후 재시도 권장
          details,
          500 // Internal Server Error
        );
    }
  }

  /**
   * 시스템 에러 생성
   */
  static createSystemError(
    errorType: RecurringPaymentErrorType,
    message?: string,
    additionalDetails?: Partial<RecurringPaymentErrorDetails>
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      occurredAt: new Date().toISOString(),
      ...additionalDetails,
    };

    switch (errorType) {
      case RecurringPaymentErrorType.VALIDATION_ERROR:
        return new RecurringPaymentError(
          errorType,
          message || '요청 데이터가 올바르지 않습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          400 // Bad Request
        );

      case RecurringPaymentErrorType.IDEMPOTENCY_CONFLICT:
        return new RecurringPaymentError(
          errorType,
          '동일한 요청이 처리 중입니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          30, // 30초 후 재시도 권장
          details,
          409 // Conflict
        );

      case RecurringPaymentErrorType.CONCURRENCY_CONFLICT:
        return new RecurringPaymentError(
          errorType,
          '동시 결제 요청으로 인한 충돌이 발생했습니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          60, // 1분 후 재시도 권장
          details,
          409 // Conflict
        );

      case RecurringPaymentErrorType.DATABASE_ERROR:
        return new RecurringPaymentError(
          errorType,
          '데이터베이스 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          300, // 5분 후 재시도 권장
          details,
          500 // Internal Server Error
        );

      case RecurringPaymentErrorType.INTERNAL_ERROR:
      default:
        return new RecurringPaymentError(
          errorType,
          message || '내부 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
          true, // 재시도 가능
          600, // 10분 후 재시도 권장
          details,
          500 // Internal Server Error
        );
    }
  }

  /**
   * 비즈니스 로직 에러 생성
   */
  static createBusinessError(
    errorType: RecurringPaymentErrorType,
    message?: string,
    additionalDetails?: Partial<RecurringPaymentErrorDetails>
  ): RecurringPaymentError {
    const details: RecurringPaymentErrorDetails = {
      occurredAt: new Date().toISOString(),
      ...additionalDetails,
    };

    switch (errorType) {
      case RecurringPaymentErrorType.INVALID_AMOUNT:
        return new RecurringPaymentError(
          errorType,
          message || '결제 금액이 올바르지 않습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          400 // Bad Request
        );

      case RecurringPaymentErrorType.INVALID_CURRENCY:
        return new RecurringPaymentError(
          errorType,
          message || '지원하지 않는 통화입니다.',
          false, // 재시도 불가능
          undefined,
          details,
          400 // Bad Request
        );

      case RecurringPaymentErrorType.SUBSCRIPTION_TYPE_INVALID:
        return new RecurringPaymentError(
          errorType,
          message || '구독 타입이 올바르지 않습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          400 // Bad Request
        );

      default:
        return new RecurringPaymentError(
          errorType,
          message || '비즈니스 로직 처리 중 오류가 발생했습니다.',
          false, // 재시도 불가능
          undefined,
          details,
          400 // Bad Request
        );
    }
  }
}