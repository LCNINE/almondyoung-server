// controllers/__tests__/shared/response-builders.ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { MockDataGenerator } from './mock-data-generator';

/**
 * API 응답 타입
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * 에러 응답 타입
 */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp?: string;
}

/**
 * HMS API 응답 타입
 */
export interface HmsApiResponse {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, any>;
}

/**
 * 테스트 응답 빌더
 * 일관된 응답 형식을 생성하여 테스트에서 사용
 */
export class TestResponseBuilder {
  /**
   * 성공 응답 생성
   */
  static buildSuccessResponse<T>(data: T, metadata?: Record<string, any>): ApiResponse<T> {
    return {
      success: true,
      data,
      ...(metadata && { metadata }),
    };
  }

  /**
   * 실패 응답 생성
   */
  static buildFailureResponse(error: string, metadata?: Record<string, any>): ApiResponse {
    return {
      success: false,
      error,
      ...(metadata && { metadata }),
    };
  }

  /**
   * HTTP 에러 응답 생성
   */
  static buildErrorResponse(
    statusCode: number,
    message: string | string[],
    error: string = 'Bad Request',
  ): ApiErrorResponse {
    return {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * HMS API 성공 응답 생성
   */
  static buildHmsSuccessResponse(data: any, metadata?: Record<string, any>): HmsApiResponse {
    return {
      success: true,
      data,
      ...(metadata && { metadata }),
    };
  }

  /**
   * HMS API 에러 응답 생성
   */
  static buildHmsErrorResponse(
    code: string,
    message: string,
    metadata?: Record<string, any>,
  ): HmsApiResponse {
    return {
      success: false,
      error: {
        code,
        message,
      },
      ...(metadata && { metadata }),
    };
  }

  /**
   * 결제 처리 성공 응답 생성
   */
  static buildPaymentSuccessResponse(
    methodType: string,
    amount: number,
    status: string = 'CAPTURED',
    additionalData?: any,
  ): any {
    const baseResponse = {
      success: true,
      transactionId: MockDataGenerator.generateTransactionId(),
      amount,
      currency: 'KRW',
      status,
      metadata: {
        gateway: this.getGatewayType(methodType),
        processedAt: new Date().toISOString(),
      },
    };

    // 결제수단별 추가 데이터
    switch (methodType) {
      case 'CARD':
        return {
          ...baseResponse,
          captureId: `cap_${Date.now()}`,
          authorizationId: `auth_${Date.now()}`,
          ...additionalData,
        };
      case 'BNPL':
        return {
          ...baseResponse,
          status: 'AUTHORIZED', // BNPL은 승인만
          authorizationId: `auth_bnpl_${Date.now()}`,
          ...additionalData,
        };
      case 'REWARD_POINT':
        return {
          ...baseResponse,
          pointTransactionId: `pt_${Date.now()}`,
          remainingBalance: 50000,
          ...additionalData,
        };
      default:
        return { ...baseResponse, ...additionalData };
    }
  }

  /**
   * 결제 처리 실패 응답 생성
   */
  static buildPaymentFailureResponse(
    methodType: string,
    errorCode: string,
    errorMessage: string,
  ): any {
    return {
      success: false,
      error: errorMessage,
      metadata: {
        gateway: this.getGatewayType(methodType),
        errorCode,
        failedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 결제수단 등록 성공 응답 생성
   */
  static buildRegistrationSuccessResponse(
    methodType: string,
    additionalData?: any,
  ): any {
    const baseResponse = {
      success: true,
      paymentMethodId: MockDataGenerator.generatePaymentMethodId(methodType),
      status: 'PENDING',
      metadata: {
        gateway: this.getGatewayType(methodType),
        registeredAt: new Date().toISOString(),
      },
    };

    // 결제수단별 추가 데이터
    switch (methodType) {
      case 'CARD':
        return {
          ...baseResponse,
          hmsMemberId: MockDataGenerator.generateHmsMemberId('CARD'),
          maskedCardNumber: '1234-****-****-5678',
          status: 'ACTIVE',
          ...additionalData,
        };
      case 'BNPL':
        return {
          ...baseResponse,
          hmsMemberId: MockDataGenerator.generateHmsMemberId('BNPL'),
          approvedLimit: 0, // 초기에는 0, 승인 후 증가
          ...additionalData,
        };
      case 'REWARD_POINT':
        return {
          ...baseResponse,
          status: 'ACTIVE',
          availableBalance: 100000,
          ...additionalData,
        };
      default:
        return { ...baseResponse, ...additionalData };
    }
  }

  /**
   * 환불 처리 성공 응답 생성
   */
  static buildRefundSuccessResponse(
    refundedAmount: number,
    originalTransactionId: string,
    additionalData?: any,
  ): any {
    return {
      success: true,
      refundId: `refund_${Date.now()}`,
      refundedAmount,
      originalTransactionId,
      status: 'COMPLETED',
      metadata: {
        refundedAt: new Date().toISOString(),
      },
      ...additionalData,
    };
  }

  /**
   * 배치 처리 성공 응답 생성
   */
  static buildBatchSuccessResponse(
    processedCount: number,
    totalAmount: number,
    additionalData?: any,
  ): any {
    return {
      success: true,
      batchId: `batch_${Date.now()}`,
      processedCount,
      failedCount: 0,
      totalAmount,
      status: 'COMPLETED',
      captureIds: Array.from({ length: processedCount }, (_, i) => `cap_batch_${Date.now()}_${i}`),
      metadata: {
        processedAt: new Date().toISOString(),
      },
      ...additionalData,
    };
  }

  /**
   * 회원 상태 조회 응답 생성
   */
  static buildMemberStatusResponse(
    status: string,
    additionalData?: any,
  ): any {
    return {
      success: true,
      status,
      hmsStatus: 'NORMAL',
      metadata: {
        checkedAt: new Date().toISOString(),
      },
      ...additionalData,
    };
  }

  /**
   * 파일 업로드 성공 응답 생성
   */
  static buildFileUploadSuccessResponse(
    agreementId: string,
    additionalData?: any,
  ): any {
    return {
      success: true,
      agreementId,
      status: 'SUBMITTED',
      metadata: {
        uploadedAt: new Date().toISOString(),
        fileSize: 1024,
      },
      ...additionalData,
    };
  }

  /**
   * 유효성 검사 에러 응답 생성
   */
  static buildValidationErrorResponse(errors: string[]): ApiErrorResponse {
    return this.buildErrorResponse(400, errors, 'Bad Request');
  }

  /**
   * 인증 에러 응답 생성
   */
  static buildAuthErrorResponse(message = '인증이 필요합니다'): ApiErrorResponse {
    return this.buildErrorResponse(401, message, 'Unauthorized');
  }

  /**
   * 권한 에러 응답 생성
   */
  static buildForbiddenErrorResponse(message = '접근 권한이 없습니다'): ApiErrorResponse {
    return this.buildErrorResponse(403, message, 'Forbidden');
  }

  /**
   * 리소스 없음 에러 응답 생성
   */
  static buildNotFoundErrorResponse(resource = '리소스'): ApiErrorResponse {
    return this.buildErrorResponse(404, `${resource}를 찾을 수 없습니다`, 'Not Found');
  }

  /**
   * 서버 에러 응답 생성
   */
  static buildInternalServerErrorResponse(message = '서버 내부 오류가 발생했습니다'): ApiErrorResponse {
    return this.buildErrorResponse(500, message, 'Internal Server Error');
  }

  /**
   * 외부 API 에러 응답 생성
   */
  static buildExternalApiErrorResponse(service = '외부 서비스'): ApiErrorResponse {
    return this.buildErrorResponse(502, `${service} 연결에 실패했습니다`, 'Bad Gateway');
  }

  /**
   * HTTP 예외 생성
   */
  static createHttpException(
    statusCode: number,
    message: string | string[],
  ): HttpException {
    return new HttpException(message, statusCode);
  }

  /**
   * 멱등성 응답 생성 (캐시된 응답)
   */
  static buildIdempotentResponse<T>(originalResponse: T): T & { fromCache: boolean } {
    return {
      ...originalResponse,
      fromCache: true,
    };
  }

  /**
   * 페이지네이션 응답 생성
   */
  static buildPaginatedResponse<T>(
    items: T[],
    page: number,
    limit: number,
    total: number,
  ): {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  } {
    const totalPages = Math.ceil(total / limit);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * 결제수단 타입에 따른 게이트웨이 타입 반환
   */
  private static getGatewayType(methodType: string): string {
    switch (methodType) {
      case 'CARD':
        return 'hms_card';
      case 'BNPL':
        return 'hms_bnpl';
      case 'EASY_PAY':
        return 'toss';
      case 'REWARD_POINT':
        return 'internal_point';
      default:
        return 'unknown';
    }
  }

  /**
   * 테스트 시나리오별 응답 생성
   */
  static buildScenarioResponse(
    scenario: 'success' | 'error' | 'validation_error' | 'not_found' | 'server_error',
    methodType: string = 'CARD',
    amount: number = 100000,
  ): any {
    switch (scenario) {
      case 'success':
        return this.buildPaymentSuccessResponse(methodType, amount);
      case 'error':
        return this.buildPaymentFailureResponse(methodType, 'PAYMENT_FAILED', '결제 처리에 실패했습니다');
      case 'validation_error':
        return this.buildValidationErrorResponse(['amount must be a positive number']);
      case 'not_found':
        return this.buildNotFoundErrorResponse('결제 세션');
      case 'server_error':
        return this.buildInternalServerErrorResponse();
      default:
        return this.buildPaymentSuccessResponse(methodType, amount);
    }
  }
}