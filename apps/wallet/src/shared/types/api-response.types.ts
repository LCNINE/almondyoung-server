/**
 * API Standard Error Response Types
 * 
 * 모든 API 엔드포인트에서 사용하는 표준 에러 응답 형태를 정의합니다.
 * 일관된 에러 구조를 통해 클라이언트 개발자의 편의성을 높입니다.
 */

// === 표준 에러 응답 규격 ===

/**
 * 표준 에러 응답 규격
 * 모든 에러 응답에 사용됩니다.
 * 
 * @example
 * {
 *   error: {
 *     code: "BNPL_ACCOUNT_NOT_FOUND",
 *     message: "BNPL 계정을 찾을 수 없습니다."
 *   }
 * }
 */
export interface StandardErrorResponse {
  code: string;            // 에러 코드 (예: "BNPL_ACCOUNT_NOT_FOUND")
  message: string;         // 사용자 친화적 에러 메시지 (한국어)
}

/**
 * API 에러 응답 래퍼
 * 실제 HTTP 응답에서 사용되는 형태입니다.
 */
export interface ApiErrorResponse {
  error: StandardErrorResponse;
}

// === 에러 코드 상수 ===

/**
 * 일관된 에러 코드 사용을 위한 상수 정의
 */
export const ERROR_CODES = {
  // BNPL 관련 에러
  BNPL_ACCOUNT_NOT_FOUND: 'BNPL_ACCOUNT_NOT_FOUND',
  BNPL_CREDIT_LIMIT_EXCEEDED: 'BNPL_CREDIT_LIMIT_EXCEEDED',
  BNPL_ACCOUNT_INACTIVE: 'BNPL_ACCOUNT_INACTIVE',
  
  // 결제 관련 에러
  PAYMENT_METHOD_INACTIVE: 'PAYMENT_METHOD_INACTIVE',
  PAYMENT_PROCESSING_FAILED: 'PAYMENT_PROCESSING_FAILED',
  PAYMENT_SESSION_NOT_FOUND: 'PAYMENT_SESSION_NOT_FOUND',
  
  // 환불 관련 에러
  REFUND_REQUEST_FAILED: 'REFUND_REQUEST_FAILED',
  REFUND_NOT_ALLOWED: 'REFUND_NOT_ALLOWED',
  REFUND_ALREADY_PROCESSED: 'REFUND_ALREADY_PROCESSED',
  
  // 일반 에러
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
// === ErrorBuilder 유틸리티 클래스 ===

/**
 * 표준 에러 응답을 쉽게 생성할 수 있는 유틸리티 클래스
 */
export class ErrorBuilder {
  /**
   * 표준 에러 응답 생성
   * @param code 에러 코드
   * @param message 에러 메시지
   * @returns ApiErrorResponse
   */
  static create(
    code: string,
    message: string
  ): ApiErrorResponse {
    return {
      error: {
        code,
        message
      }
    };
  }

  /**
   * 에러 코드 상수를 사용하여 에러 응답 생성
   * @param errorCode ERROR_CODES 상수
   * @param message 에러 메시지
   * @returns ApiErrorResponse
   */
  static fromCode(
    errorCode: ErrorCode,
    message: string
  ): ApiErrorResponse {
    return this.create(errorCode, message);
  }

  /**
   * 에러 코드와 언어를 사용하여 자동 메시지 생성
   * @param errorCode ERROR_CODES 상수
   * @param language 언어 ('ko' | 'en')
   * @returns ApiErrorResponse
   */
  static fromCodeWithMessage(
    errorCode: ErrorCode,
    language: 'ko' | 'en' = 'ko'
  ): ApiErrorResponse {
    const message = getErrorMessage(errorCode, language);
    return this.fromCode(errorCode, message);
  }
}

// === HTTP 상태 코드 매핑 ===

/**
 * HTTP 상태 코드를 표준 에러 코드로 매핑
 */
export const HTTP_STATUS_TO_ERROR_CODE: Record<number, ErrorCode> = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  500: ERROR_CODES.INTERNAL_ERROR
};

// === 에러 메시지 다국어 지원 ===

/**
 * 에러 메시지 국제화 지원
 */
export const ERROR_MESSAGES = {
  [ERROR_CODES.BNPL_ACCOUNT_NOT_FOUND]: {
    ko: 'BNPL 계정을 찾을 수 없습니다.',
    en: 'BNPL account not found.'
  },
  [ERROR_CODES.BNPL_CREDIT_LIMIT_EXCEEDED]: {
    ko: 'BNPL 신용 한도를 초과했습니다.',
    en: 'BNPL credit limit exceeded.'
  },
  [ERROR_CODES.BNPL_ACCOUNT_INACTIVE]: {
    ko: 'BNPL 계정이 비활성화되어 있습니다.',
    en: 'BNPL account is inactive.'
  },
  [ERROR_CODES.PAYMENT_METHOD_INACTIVE]: {
    ko: '결제수단이 활성화되지 않았습니다.',
    en: 'Payment method is not active.'
  },
  [ERROR_CODES.PAYMENT_PROCESSING_FAILED]: {
    ko: '결제 처리 중 오류가 발생했습니다.',
    en: 'Payment processing failed.'
  },
  [ERROR_CODES.PAYMENT_SESSION_NOT_FOUND]: {
    ko: '결제 세션을 찾을 수 없습니다.',
    en: 'Payment session not found.'
  },
  [ERROR_CODES.REFUND_REQUEST_FAILED]: {
    ko: '환불 요청 처리 중 오류가 발생했습니다.',
    en: 'Refund request failed.'
  },
  [ERROR_CODES.REFUND_NOT_ALLOWED]: {
    ko: '환불이 허용되지 않습니다.',
    en: 'Refund not allowed.'
  },
  [ERROR_CODES.REFUND_ALREADY_PROCESSED]: {
    ko: '이미 처리된 환불 요청입니다.',
    en: 'Refund already processed.'
  },
  [ERROR_CODES.INTERNAL_ERROR]: {
    ko: '서버 내부 오류가 발생했습니다.',
    en: 'Internal server error occurred.'
  },
  [ERROR_CODES.VALIDATION_ERROR]: {
    ko: '입력 데이터 검증에 실패했습니다.',
    en: 'Input validation failed.'
  },
  [ERROR_CODES.UNAUTHORIZED]: {
    ko: '인증이 필요합니다.',
    en: 'Authentication required.'
  },
  [ERROR_CODES.FORBIDDEN]: {
    ko: '접근 권한이 없습니다.',
    en: 'Access forbidden.'
  },
  [ERROR_CODES.NOT_FOUND]: {
    ko: '요청한 리소스를 찾을 수 없습니다.',
    en: 'Requested resource not found.'
  }
} as const;

/**
 * 언어별 에러 메시지 조회
 * @param errorCode 에러 코드
 * @param language 언어 ('ko' | 'en')
 * @returns 에러 메시지
 */
export function getErrorMessage(
  errorCode: ErrorCode, 
  language: 'ko' | 'en' = 'ko'
): string {
  return ERROR_MESSAGES[errorCode]?.[language] || ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR][language];
}