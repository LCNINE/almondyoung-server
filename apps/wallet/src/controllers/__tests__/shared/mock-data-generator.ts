// controllers/__tests__/shared/mock-data-generator.ts
import { generateUUIDv7 } from '../../../shared/utils/id-generator';
import {
  ProcessPaymentDto,
  PaymentMethodRequestDto,
  ProcessPaymentResponseDto,
  PaymentResultDto,
} from '../../../shared/dtos/payments/process-payment.dto';
import { CreateGeneralPaymentMethodDto } from '../../../shared/dtos/create-general-payment-method.dto';
import { CreatePaymentSessionDto } from '../../../shared/dtos/create-payment-session.dto';
import { PaymentMethodResponseDto } from '../../../shared/dtos/payment-methods/payment-method-response.dto';
import { CreateBNPLMethodDto } from '../../../shared/dtos/bnpl/create-bnpl-method.dto';
import { SubmitConsentDto } from '../../../shared/dtos/bnpl/submit-consent.dto';
import { PaymentMethodType, PaymentStatus } from '../../../shared/types/payment-method.types';

/**
 * 테스트 데이터 생성기
 * 일관된 테스트 데이터를 생성하여 모든 컨트롤러 테스트에서 사용
 */
export class MockDataGenerator {
  /**
   * 기본 사용자 ID 생성
   */
  static generateUserId(prefix = 'user'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * 기본 세션 ID 생성
   */
  static generateSessionId(prefix = 'session'): string {
    return `${prefix}_${generateUUIDv7()}`;
  }

  /**
   * 기본 결제수단 ID 생성
   */
  static generatePaymentMethodId(type: string, prefix = 'pm'): string {
    return `${prefix}_${type.toLowerCase()}_${generateUUIDv7()}`;
  }

  /**
   * 기본 거래 ID 생성
   */
  static generateTransactionId(prefix = 'txn'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  }

  /**
   * HMS 회원 ID 생성
   */
  static generateHmsMemberId(type: 'CARD' | 'BNPL' = 'BNPL'): string {
    return `HMS_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }

  /**
   * 결제 세션 생성 DTO
   */
  static generateCreatePaymentSessionDto(overrides: Partial<CreatePaymentSessionDto> = {}): CreatePaymentSessionDto {
    return {
      userId: this.generateUserId(),
      amount: 100000,
      currency: 'KRW',
      requiresManualCapture: false,
      metadata: {
        orderId: `order_${Date.now()}`,
        customerName: '테스트 고객',
        orderName: '아몬드영 테스트 상품',
      },
      ...overrides,
    };
  }

  /**
   * 결제수단 요청 DTO
   */
  static generatePaymentMethodRequestDto(overrides: Partial<PaymentMethodRequestDto> = {}): PaymentMethodRequestDto {
    return {
      paymentMethodId: this.generatePaymentMethodId('card'),
      amount: 50000,
      type: 'CARD',
      ...overrides,
    };
  }

  /**
   * 결제 처리 DTO
   */
  static generateProcessPaymentDto(overrides: Partial<ProcessPaymentDto> = {}): ProcessPaymentDto {
    return {
      sessionId: this.generateSessionId(),
      paymentMethods: [this.generatePaymentMethodRequestDto()],
      userId: this.generateUserId(),
      usePoints: 0,
      idemKey: `idem_${Date.now()}`,
      metadata: {
        orderName: '아몬드영 테스트 결제',
        orderId: `order_${Date.now()}`,
      },
      ...overrides,
    };
  }

  /**
   * 결제 결과 DTO
   */
  static generatePaymentResultDto(overrides: Partial<PaymentResultDto> = {}): PaymentResultDto {
    return {
      methodType: 'CARD',
      amount: 50000,
      status: 'CAPTURED',
      authorizationIds: [`auth_${Date.now()}`],
      captureIds: [`cap_${Date.now()}`],
      transactionId: this.generateTransactionId(),
      ...overrides,
    };
  }

  /**
   * 결제 처리 응답 DTO
   */
  static generateProcessPaymentResponseDto(overrides: Partial<ProcessPaymentResponseDto> = {}): ProcessPaymentResponseDto {
    return {
      success: true,
      paymentId: `pay_${generateUUIDv7()}`,
      sessionId: this.generateSessionId(),
      totalAmount: 100000,
      results: [this.generatePaymentResultDto()],
      ...overrides,
    };
  }

  /**
   * 일반 결제수단 생성 DTO
   */
  static generateCreateGeneralPaymentMethodDto(
    type: 'CARD' | 'REWARD_POINT' = 'CARD',
    overrides: Partial<CreateGeneralPaymentMethodDto> = {},
  ): CreateGeneralPaymentMethodDto {
    const baseDto: CreateGeneralPaymentMethodDto = {
      userId: this.generateUserId(),
      methodType: type,
      methodName: `테스트 ${type} 결제수단`,
    };

    // 타입별 특화 데이터 추가
    switch (type) {
      case 'CARD':
        baseDto.cardInfo = this.generateCardInfo();
        break;
      case 'REWARD_POINT':
        // REWARD_POINT는 별도 정보가 필요하지 않음
        break;
    }

    return { ...baseDto, ...overrides };
  }

  /**
   * 카드 정보 생성
   */
  static generateCardInfo(overrides: any = {}): any {
    return {
      cardNumber: '1234567890123456',
      expiryDate: '12/25',
      cardHolderName: '테스트 사용자',
      phone: '010-1234-5678',
      billingCycleDay: 15,
      ...overrides,
    };
  }

  /**
   * 포인트 정보 생성
   */
  static generatePointInfo(overrides: any = {}): any {
    return {
      pointType: 'REWARD',
      availableBalance: 100000,
      ...overrides,
    };
  }

  /**
   * 결제수단 응답 DTO
   */
  static generatePaymentMethodResponseDto(overrides: Partial<PaymentMethodResponseDto> = {}): PaymentMethodResponseDto {
    return {
      id: this.generatePaymentMethodId('card'),
      userId: this.generateUserId(),
      methodType: 'CARD',
      methodName: '테스트 카드',
      status: 'ACTIVE',
      isDefault: false,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * BNPL 회원 등록 DTO
   */
  static generateCreateBnplMethodDto(overrides: Partial<CreateBNPLMethodDto> = {}): CreateBNPLMethodDto {
    return {
      userId: this.generateUserId(),
      methodName: '아몬드영 후불결제',
      memberName: '테스트 BNPL 사용자',
      phone: '01012345678',
      creditLimit: 1000000,
      billingCycleDay: 25,
      termsUrl: 'https://example.com/terms',
      ...overrides,
    };
  }

  /**
   * 출금동의서 제출 DTO
   */
  static generateSubmitConsentDto(overrides: Partial<SubmitConsentDto> = {}): SubmitConsentDto {
    return {
      memberId: this.generateHmsMemberId('BNPL'),
      ...overrides,
    };
  }

  /**
   * Mock 파일 객체 생성 (multer 파일 시뮬레이션)
   */
  static generateMockFile(overrides: any = {}): any {
    return {
      fieldname: 'file',
      originalname: 'test-agreement.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('test file content'),
      size: 1024,
      ...overrides,
    };
  }

  /**
   * 환불 요청 DTO
   */
  static generateRefundRequestDto(overrides: any = {}): any {
    return {
      transactionId: this.generateTransactionId(),
      amount: 25000,
      reason: '고객 요청',
      ...overrides,
    };
  }

  /**
   * 정산 배치 요청 DTO
   */
  static generateSettlementBatchDto(overrides: any = {}): any {
    return {
      periodStart: new Date('2024-01-01'),
      periodEnd: new Date('2024-01-31'),
      batchType: 'MONTHLY',
      ...overrides,
    };
  }

  /**
   * 에러 응답 생성
   */
  static generateErrorResponse(statusCode: number, message: string, error = 'Bad Request'): any {
    return {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 성공 응답 생성
   */
  static generateSuccessResponse<T>(data: T): { success: boolean; data: T } {
    return {
      success: true,
      data,
    };
  }

  /**
   * 실패 응답 생성
   */
  static generateFailureResponse(error: string): { success: boolean; error: string } {
    return {
      success: false,
      error,
    };
  }

  /**
   * 페이지네이션 응답 생성
   */
  static generatePaginatedResponse<T>(
    items: T[],
    page = 1,
    limit = 10,
    total?: number,
  ): {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  } {
    const actualTotal = total ?? items.length;
    return {
      items,
      pagination: {
        page,
        limit,
        total: actualTotal,
        totalPages: Math.ceil(actualTotal / limit),
      },
    };
  }

  /**
   * 랜덤 금액 생성 (테스트용)
   */
  static generateRandomAmount(min = 1000, max = 1000000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 랜덤 날짜 생성 (테스트용)
   */
  static generateRandomDate(daysFromNow = 30): Date {
    const now = new Date();
    const randomDays = Math.floor(Math.random() * daysFromNow);
    return new Date(now.getTime() + randomDays * 24 * 60 * 60 * 1000);
  }

  /**
   * 테스트 시나리오별 데이터 생성
   */
  static generateScenarioData(scenario: 'success' | 'error' | 'validation_error' | 'not_found'): any {
    switch (scenario) {
      case 'success':
        return {
          payment: this.generateProcessPaymentDto(),
          response: this.generateProcessPaymentResponseDto(),
        };
      case 'error':
        return {
          payment: this.generateProcessPaymentDto({ paymentMethods: [] }), // 빈 결제수단
          error: this.generateErrorResponse(400, '결제수단이 필요합니다'),
        };
      case 'validation_error':
        return {
          payment: this.generateProcessPaymentDto({ 
            paymentMethods: [{ ...this.generatePaymentMethodRequestDto(), amount: -1000 }] 
          }),
          error: this.generateErrorResponse(400, '결제 금액은 0보다 커야 합니다'),
        };
      case 'not_found':
        return {
          payment: this.generateProcessPaymentDto({ sessionId: 'non_existent_session' }),
          error: this.generateErrorResponse(404, '결제 세션을 찾을 수 없습니다'),
        };
      default:
        return this.generateScenarioData('success');
    }
  }
}