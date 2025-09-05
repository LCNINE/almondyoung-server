// controllers/__tests__/shared/test-fixtures.ts
import { MockDataGenerator } from './mock-data-generator';
import { TestApiClientFactory, TestScenario } from './test-api-client-factory';
import { PaymentMethodType, PaymentStatus } from '../../../shared/types/payment-method.types';

/**
 * 테스트 픽스처 - 미리 정의된 테스트 데이터 세트
 */
export class TestFixtures {
  /**
   * 결제 관련 픽스처
   */
  static readonly PAYMENT_FIXTURES = {
    // 성공적인 카드 결제
    SUCCESSFUL_CARD_PAYMENT: {
      request: MockDataGenerator.generateProcessPaymentDto({
        paymentMethods: [
          MockDataGenerator.generatePaymentMethodRequestDto({
            type: 'CARD',
            amount: 100000,
          }),
        ],
      }),
      response: MockDataGenerator.generateProcessPaymentResponseDto({
        results: [
          MockDataGenerator.generatePaymentResultDto({
            methodType: 'CARD',
            status: 'CAPTURED',
            amount: 100000,
          }),
        ],
      }),
    },

    // 성공적인 BNPL 결제 (승인만)
    SUCCESSFUL_BNPL_PAYMENT: {
      request: MockDataGenerator.generateProcessPaymentDto({
        paymentMethods: [
          MockDataGenerator.generatePaymentMethodRequestDto({
            type: 'BNPL',
            amount: 200000,
          }),
        ],
      }),
      response: MockDataGenerator.generateProcessPaymentResponseDto({
        results: [
          MockDataGenerator.generatePaymentResultDto({
            methodType: 'BNPL',
            status: 'AUTHORIZED',
            amount: 200000,
            captureIds: undefined, // BNPL은 승인만
          }),
        ],
      }),
    },

    // 혼합 결제 (카드 + 포인트)
    MIXED_PAYMENT: {
      request: MockDataGenerator.generateProcessPaymentDto({
        paymentMethods: [
          MockDataGenerator.generatePaymentMethodRequestDto({
            type: 'CARD',
            amount: 80000,
          }),
        ],
        usePoints: 20000,
      }),
      response: MockDataGenerator.generateProcessPaymentResponseDto({
        totalAmount: 100000,
        results: [
          MockDataGenerator.generatePaymentResultDto({
            methodType: 'CARD',
            amount: 80000,
          }),
          MockDataGenerator.generatePaymentResultDto({
            methodType: 'REWARD_POINT',
            amount: 20000,
          }),
        ],
      }),
    },

    // 결제 실패
    FAILED_PAYMENT: {
      request: MockDataGenerator.generateProcessPaymentDto(),
      error: MockDataGenerator.generateErrorResponse(400, '결제 처리에 실패했습니다'),
    },

    // 세션 없음
    SESSION_NOT_FOUND: {
      request: MockDataGenerator.generateProcessPaymentDto({
        sessionId: 'non_existent_session',
      }),
      error: MockDataGenerator.generateErrorResponse(404, '결제 세션을 찾을 수 없습니다'),
    },
  };

  /**
   * 결제수단 관련 픽스처
   */
  static readonly PAYMENT_METHOD_FIXTURES = {
    // 카드 등록 성공
    SUCCESSFUL_CARD_REGISTRATION: {
      request: MockDataGenerator.generateCreateGeneralPaymentMethodDto(PaymentMethodType.CARD),
      response: MockDataGenerator.generatePaymentMethodResponseDto({
        methodType: PaymentMethodType.CARD,
        status: 'ACTIVE',
        hmsMemberId: MockDataGenerator.generateHmsMemberId('CARD'),
      }),
    },

    // 포인트 등록 성공
    SUCCESSFUL_POINT_REGISTRATION: {
      request: MockDataGenerator.generateCreateGeneralPaymentMethodDto(PaymentMethodType.REWARD_POINT),
      response: MockDataGenerator.generatePaymentMethodResponseDto({
        methodType: PaymentMethodType.REWARD_POINT,
        status: 'ACTIVE',
      }),
    },

    // 등록 실패
    REGISTRATION_FAILED: {
      request: MockDataGenerator.generateCreateGeneralPaymentMethodDto(PaymentMethodType.CARD, {
        cardInfo: MockDataGenerator.generateCardInfo({ cardNumber: 'invalid' }),
      }),
      error: MockDataGenerator.generateErrorResponse(400, '유효하지 않은 카드 정보입니다'),
    },

    // 사용자 결제수단 목록
    USER_PAYMENT_METHODS: {
      userId: MockDataGenerator.generateUserId(),
      response: {
        active: [
          MockDataGenerator.generatePaymentMethodResponseDto({
            methodType: PaymentMethodType.CARD,
            status: 'ACTIVE',
            isDefault: true,
          }),
          MockDataGenerator.generatePaymentMethodResponseDto({
            methodType: PaymentMethodType.REWARD_POINT,
            status: 'ACTIVE',
            isDefault: false,
          }),
        ],
        pending: [
          MockDataGenerator.generatePaymentMethodResponseDto({
            methodType: PaymentMethodType.BNPL,
            status: 'PENDING',
            isDefault: false,
          }),
        ],
        inactive: [],
      },
    },
  };

  /**
   * BNPL 관련 픽스처
   */
  static readonly BNPL_FIXTURES = {
    // BNPL 회원 등록 성공
    SUCCESSFUL_MEMBER_REGISTRATION: {
      request: MockDataGenerator.generateCreateBnplMethodDto(),
      response: {
        success: true,
        hmsMemberId: MockDataGenerator.generateHmsMemberId('BNPL'),
        status: 'PENDING',
        message: 'BNPL 회원 등록이 완료되었습니다',
      },
    },

    // 출금동의서 제출 성공
    SUCCESSFUL_CONSENT_SUBMISSION: {
      request: MockDataGenerator.generateSubmitConsentDto(),
      file: MockDataGenerator.generateMockFile({
        originalname: 'withdrawal-consent.pdf',
        mimetype: 'application/pdf',
      }),
      response: {
        success: true,
        agreementId: `agreement_${Date.now()}`,
        message: '출금동의서가 성공적으로 제출되었습니다',
      },
    },

    // 회원 상태 조회
    MEMBER_STATUS_ACTIVE: {
      hmsMemberId: MockDataGenerator.generateHmsMemberId('BNPL'),
      response: {
        success: true,
        status: 'ACTIVE',
        approvedLimit: 500000,
        currentBalance: 0,
        hmsStatus: 'NORMAL',
      },
    },

    // 회원 없음
    MEMBER_NOT_FOUND: {
      hmsMemberId: 'non_existent_member',
      error: MockDataGenerator.generateErrorResponse(404, 'BNPL 회원을 찾을 수 없습니다'),
    },
  };

  /**
   * 결제 세션 관련 픽스처
   */
  static readonly SESSION_FIXTURES = {
    // 세션 생성 성공
    SUCCESSFUL_SESSION_CREATION: {
      request: MockDataGenerator.generateCreatePaymentSessionDto(),
      response: {
        id: MockDataGenerator.generateSessionId(),
        checkoutUrl: 'https://checkout.example.com/session_123',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        status: 'PENDING',
      },
    },

    // 세션 조회 성공
    ACTIVE_SESSION: {
      sessionId: MockDataGenerator.generateSessionId(),
      response: {
        id: MockDataGenerator.generateSessionId(),
        userId: MockDataGenerator.generateUserId(),
        amount: 100000,
        currency: 'KRW',
        status: 'PENDING',
        checkoutUrl: 'https://checkout.example.com/session_123',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    },

    // 만료된 세션
    EXPIRED_SESSION: {
      sessionId: MockDataGenerator.generateSessionId(),
      response: {
        id: MockDataGenerator.generateSessionId(),
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1분 전 만료
      },
    },
  };

  /**
   * 환불 관련 픽스처
   */
  static readonly REFUND_FIXTURES = {
    // 전액 환불 성공
    SUCCESSFUL_FULL_REFUND: {
      request: MockDataGenerator.generateRefundRequestDto({
        amount: 100000,
        reason: '고객 요청',
      }),
      response: {
        success: true,
        refundId: `refund_${Date.now()}`,
        refundedAmount: 100000,
        status: 'COMPLETED',
      },
    },

    // 부분 환불 성공
    SUCCESSFUL_PARTIAL_REFUND: {
      request: MockDataGenerator.generateRefundRequestDto({
        amount: 50000,
        reason: '부분 취소',
      }),
      response: {
        success: true,
        refundId: `refund_${Date.now()}`,
        refundedAmount: 50000,
        status: 'COMPLETED',
      },
    },

    // 환불 실패
    REFUND_FAILED: {
      request: MockDataGenerator.generateRefundRequestDto(),
      error: MockDataGenerator.generateErrorResponse(400, '환불 처리에 실패했습니다'),
    },
  };

  /**
   * 정산 관련 픽스처
   */
  static readonly SETTLEMENT_FIXTURES = {
    // 월별 정산 성공
    SUCCESSFUL_MONTHLY_SETTLEMENT: {
      request: MockDataGenerator.generateSettlementBatchDto(),
      response: {
        success: true,
        batchId: `batch_${Date.now()}`,
        totalAmount: 5000000,
        processedCount: 100,
        failedCount: 0,
        status: 'COMPLETED',
      },
    },

    // 배치 상태 조회
    BATCH_STATUS_COMPLETED: {
      batchId: `batch_${Date.now()}`,
      response: {
        success: true,
        batch: {
          id: `batch_${Date.now()}`,
          status: 'COMPLETED',
          totalAmount: 5000000,
          processedCount: 100,
          failedCount: 0,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      },
    },
  };

  /**
   * 에러 시나리오 픽스처
   */
  static readonly ERROR_FIXTURES = {
    // 유효성 검사 오류
    VALIDATION_ERROR: MockDataGenerator.generateErrorResponse(
      400,
      'amount must be a positive number',
      'Bad Request',
    ),

    // 인증 오류
    UNAUTHORIZED_ERROR: MockDataGenerator.generateErrorResponse(
      401,
      '인증이 필요합니다',
      'Unauthorized',
    ),

    // 권한 오류
    FORBIDDEN_ERROR: MockDataGenerator.generateErrorResponse(
      403,
      '접근 권한이 없습니다',
      'Forbidden',
    ),

    // 리소스 없음
    NOT_FOUND_ERROR: MockDataGenerator.generateErrorResponse(
      404,
      '요청한 리소스를 찾을 수 없습니다',
      'Not Found',
    ),

    // 서버 오류
    INTERNAL_SERVER_ERROR: MockDataGenerator.generateErrorResponse(
      500,
      '서버 내부 오류가 발생했습니다',
      'Internal Server Error',
    ),

    // 외부 API 오류
    EXTERNAL_API_ERROR: MockDataGenerator.generateErrorResponse(
      502,
      '외부 서비스 연결에 실패했습니다',
      'Bad Gateway',
    ),
  };

  /**
   * 멱등성 테스트 픽스처
   */
  static readonly IDEMPOTENCY_FIXTURES = {
    // 첫 번째 요청
    FIRST_REQUEST: {
      idempotencyKey: `idem_${Date.now()}_first`,
      request: MockDataGenerator.generateProcessPaymentDto(),
      response: MockDataGenerator.generateProcessPaymentResponseDto(),
    },

    // 중복 요청 (같은 멱등성 키)
    DUPLICATE_REQUEST: {
      idempotencyKey: `idem_${Date.now()}_first`, // 같은 키
      request: MockDataGenerator.generateProcessPaymentDto(),
      response: MockDataGenerator.generateProcessPaymentResponseDto(), // 같은 응답
    },
  };

  /**
   * 특정 시나리오에 맞는 픽스처 조합 생성
   */
  static createScenarioFixture(
    scenario: TestScenario,
    paymentMethod: 'CARD' | 'BNPL' | 'POINT' = 'CARD',
  ): any {
    switch (scenario) {
      case 'success':
        return paymentMethod === 'CARD' 
          ? this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT
          : this.PAYMENT_FIXTURES.SUCCESSFUL_BNPL_PAYMENT;
      
      case 'error':
        return this.PAYMENT_FIXTURES.FAILED_PAYMENT;
      
      case 'timeout':
        return {
          ...this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT,
          error: MockDataGenerator.generateErrorResponse(408, '요청 시간이 초과되었습니다', 'Request Timeout'),
        };
      
      case 'network_error':
        return {
          ...this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT,
          error: this.ERROR_FIXTURES.EXTERNAL_API_ERROR,
        };
      
      case 'auth_error':
        return {
          ...this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT,
          error: this.ERROR_FIXTURES.UNAUTHORIZED_ERROR,
        };
      
      default:
        return this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT;
    }
  }

  /**
   * 테스트 환경별 픽스처 생성
   */
  static createEnvironmentFixture(useMock: boolean, paymentMethod: 'CARD' | 'BNPL' = 'CARD'): any {
    const baseFixture = paymentMethod === 'CARD' 
      ? this.PAYMENT_FIXTURES.SUCCESSFUL_CARD_PAYMENT
      : this.PAYMENT_FIXTURES.SUCCESSFUL_BNPL_PAYMENT;

    return {
      ...baseFixture,
      environment: {
        useMock,
        paymentMethod,
        // hms-api-wrapper를 직접 활용하므로 클라이언트 생성은 실제 테스트에서 수행
        environmentConfig: {
          USE_MOCK: useMock.toString(),
          NODE_ENV: 'test',
          ...(paymentMethod === 'CARD' && !useMock && {
            SW_KEY: 'test_sw_key',
            CUST_KEY: 'test_cust_key',
          }),
        },
      },
    };
  }
}