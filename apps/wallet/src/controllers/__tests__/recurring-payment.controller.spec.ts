// controllers/__tests__/recurring-payment.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { RecurringPaymentController } from '../recurring-payment.controller';
import { RecurringPaymentService } from '../../services/recurring-payment.service';
import {
  RecurringPaymentRequestDto,
  RecurringPaymentResponseDto,
  PaymentMethodValidationRequestDto,
  PaymentMethodValidationResponseDto,
  PaymentStatusResponseDto,
} from '../../shared/dtos/recurring-payment.dto';

describe('RecurringPaymentController', () => {
  let controller: RecurringPaymentController;
  let recurringPaymentService: jest.Mocked<RecurringPaymentService>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock 서비스 생성
    const mockRecurringPaymentService = {
      processRecurringPayment: jest.fn(),
      processRecurringPaymentWithRetry: jest.fn(),
      validatePaymentMethodForSubscription: jest.fn(),
      getPaymentStatus: jest.fn(),
    };

    module = await Test.createTestingModule({
      controllers: [RecurringPaymentController],
      providers: [
        {
          provide: RecurringPaymentService,
          useValue: mockRecurringPaymentService,
        },
      ],
    }).compile();

    controller = module.get<RecurringPaymentController>(RecurringPaymentController);
    recurringPaymentService = module.get<RecurringPaymentService>(
      RecurringPaymentService,
    ) as jest.Mocked<RecurringPaymentService>;
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  describe('processRecurringPayment', () => {
    const mockRequest: RecurringPaymentRequestDto = {
      userId: 'user_123456789',
      paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
      amount: 9900,
      currency: 'KRW',
      subscriptionType: 'monthly',
      billingCycle: 30,
    };

    describe('성공 시나리오', () => {
      it('구독 결제 처리 성공', async () => {
        // Given
        const mockResponse: RecurringPaymentResponseDto = {
          success: true,
          transactionId: 'txn_01HQZX8QJKMNPQRST9VWXY012',
          paymentEventId: 'pe_01HQZX8QJKMNPQRST9VWXY012',
          status: 'CAPTURED',
          amount: 9900,
          processedAt: new Date('2024-01-15T10:30:00.000Z'),
          gatewayResponse: {
            approvalNumber: 'APPR123456',
            paymentDate: '20240115',
          },
        };

        recurringPaymentService.processRecurringPaymentWithRetry.mockResolvedValue(mockResponse);

        // When
        const result = await controller.processRecurringPayment(mockRequest, 'idem_key_123');

        // Then
        expect(result).toEqual(mockResponse);
        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledWith(
          mockRequest,
          'idem_key_123',
          3,
        );
        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledTimes(1);
      });

      it('멱등성 키 없이 구독 결제 처리 성공', async () => {
        // Given
        const mockResponse: RecurringPaymentResponseDto = {
          success: true,
          transactionId: 'txn_01HQZX8QJKMNPQRST9VWXY012',
          paymentEventId: 'pe_01HQZX8QJKMNPQRST9VWXY012',
          status: 'CAPTURED',
          amount: 9900,
          processedAt: new Date('2024-01-15T10:30:00.000Z'),
        };

        recurringPaymentService.processRecurringPaymentWithRetry.mockResolvedValue(mockResponse);

        // When
        const result = await controller.processRecurringPayment(mockRequest);

        // Then
        expect(result).toEqual(mockResponse);
        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledWith(
          mockRequest,
          undefined,
          3,
        );
      });
    });

    describe('실패 시나리오', () => {
      it('결제수단 검증 실패 시 BadRequestException 발생', async () => {
        // Given
        recurringPaymentService.processRecurringPaymentWithRetry.mockRejectedValue(
          new BadRequestException('구독 결제가 허용되지 않은 결제수단입니다'),
        );

        // When & Then
        await expect(
          controller.processRecurringPayment(mockRequest),
        ).rejects.toThrow(BadRequestException);

        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledWith(
          mockRequest,
          undefined,
          3,
        );
      });

      it('결제 실패 시 예외 발생', async () => {
        // Given
        recurringPaymentService.processRecurringPaymentWithRetry.mockRejectedValue(
          new Error('잔액이 부족합니다'),
        );

        // When & Then
        await expect(
          controller.processRecurringPayment(mockRequest),
        ).rejects.toThrow('잔액이 부족합니다');

        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledWith(
          mockRequest,
          undefined,
          3,
        );
      });

      it('동시성 충돌 시 ConflictException 발생', async () => {
        // Given
        recurringPaymentService.processRecurringPaymentWithRetry.mockRejectedValue(
          new ConflictException('동시 결제 요청으로 인한 충돌이 발생했습니다. 잠시 후 다시 시도해주세요.'),
        );

        // When & Then
        await expect(
          controller.processRecurringPayment(mockRequest),
        ).rejects.toThrow(ConflictException);

        expect(recurringPaymentService.processRecurringPaymentWithRetry).toHaveBeenCalledWith(
          mockRequest,
          undefined,
          3,
        );
      });
    });
  });

  describe('getRecurringPaymentStatus', () => {
    const transactionId = 'txn_01HQZX8QJKMNPQRST9VWXY012';

    describe('성공 시나리오', () => {
      it('결제 상태 조회 성공', async () => {
        // Given
        const mockResponse: PaymentStatusResponseDto = {
          transactionId,
          paymentEventId: 'pe_01HQZX8QJKMNPQRST9VWXY012',
          status: 'CAPTURED',
          amount: 9900,
          currency: 'KRW',
          processedAt: new Date('2024-01-15T10:30:00.000Z'),
          isSubscriptionPayment: true,
          subscriptionType: 'monthly',
          paymentPurpose: 'SUBSCRIPTION',
        };

        recurringPaymentService.getPaymentStatus.mockResolvedValue(mockResponse);

        // When
        const result = await controller.getRecurringPaymentStatus(transactionId);

        // Then
        expect(result).toEqual(mockResponse);
        expect(recurringPaymentService.getPaymentStatus).toHaveBeenCalledWith(transactionId);
        expect(recurringPaymentService.getPaymentStatus).toHaveBeenCalledTimes(1);
      });
    });

    describe('실패 시나리오', () => {
      it('존재하지 않는 트랜잭션 조회 시 NotFoundException 발생', async () => {
        // Given
        recurringPaymentService.getPaymentStatus.mockRejectedValue(
          new NotFoundException('결제 트랜잭션을 찾을 수 없습니다'),
        );

        // When & Then
        await expect(
          controller.getRecurringPaymentStatus(transactionId),
        ).rejects.toThrow(NotFoundException);

        expect(recurringPaymentService.getPaymentStatus).toHaveBeenCalledWith(transactionId);
      });
    });
  });

  describe('validatePaymentMethod', () => {
    const mockRequest: PaymentMethodValidationRequestDto = {
      paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
      userId: 'user_123456789',
      methodType: 'CARD',
    };

    describe('성공 시나리오', () => {
      it('구독용 결제수단 검증 성공', async () => {
        // Given
        const mockResponse: PaymentMethodValidationResponseDto = {
          isValid: true,
          paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
          methodType: 'CARD',
          status: 'ACTIVE',
          paymentPurpose: 'SUBSCRIPTION',
          hmsMemberId: 'HMS_123456789',
        };

        recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

        // When
        const result = await controller.validatePaymentMethod(mockRequest);

        // Then
        expect(result).toEqual(mockResponse);
        expect(recurringPaymentService.validatePaymentMethodForSubscription).toHaveBeenCalledWith(
          mockRequest.paymentMethodId,
          mockRequest.userId,
          undefined,
          true,
        );
        expect(recurringPaymentService.validatePaymentMethodForSubscription).toHaveBeenCalledTimes(1);
      });

      it('구독용 결제수단 검증 실패 - PURCHASE 전용', async () => {
        // Given
        const mockResponse: PaymentMethodValidationResponseDto = {
          isValid: false,
          paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
          methodType: 'CARD',
          status: 'ACTIVE',
          paymentPurpose: 'PURCHASE',
          error: '구독 결제가 허용되지 않은 결제수단입니다',
        };

        recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

        // When
        const result = await controller.validatePaymentMethod(mockRequest);

        // Then
        expect(result).toEqual(mockResponse);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('구독 결제가 허용되지 않은 결제수단입니다');
      });

      it('HMS 상태 검증 실패', async () => {
        // Given
        const mockResponse: PaymentMethodValidationResponseDto = {
          isValid: false,
          paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
          methodType: 'CARD',
          status: 'ACTIVE',
          paymentPurpose: 'SUBSCRIPTION',
          error: '회원 등록이 진행중입니다. 잠시 후에 시도해주세요',
          validationDetails: { hmsStatus: '신청중' },
        };

        recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

        // When
        const result = await controller.validatePaymentMethod(mockRequest);

        // Then
        expect(result).toEqual(mockResponse);
        expect(result.isValid).toBe(false);
        expect(result.validationDetails?.hmsStatus).toBe('신청중');
      });
    });

    describe('실패 시나리오', () => {
      it('존재하지 않는 결제수단 검증 시 에러 응답', async () => {
        // Given
        const mockResponse: PaymentMethodValidationResponseDto = {
          isValid: false,
          paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
          methodType: 'UNKNOWN',
          status: 'UNKNOWN',
          paymentPurpose: 'PURCHASE',
          error: '결제수단 검증 중 오류가 발생했습니다',
        };

        recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

        // When
        const result = await controller.validatePaymentMethod(mockRequest);

        // Then
        expect(result).toEqual(mockResponse);
        expect(result.isValid).toBe(false);
        expect(result.methodType).toBe('UNKNOWN');
      });
    });
  });

  describe('컨트롤러 의존성 주입', () => {
    it('RecurringPaymentService가 올바르게 주입되어야 함', () => {
      expect(controller).toBeDefined();
      expect(recurringPaymentService).toBeDefined();
    });

    it('Logger가 올바르게 초기화되어야 함', () => {
      expect(controller['logger']).toBeDefined();
      // Note: context is a protected property, so we can't access it directly in tests
      expect(controller['logger']).toBeInstanceOf(Logger);
    });
  });

  describe('API 응답 형식', () => {
    it('processRecurringPayment 응답이 올바른 형식이어야 함', async () => {
      // Given
      const mockRequest: RecurringPaymentRequestDto = {
        userId: 'user_123456789',
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        amount: 9900,
        subscriptionType: 'monthly',
      };

      const mockResponse: RecurringPaymentResponseDto = {
        success: true,
        transactionId: 'txn_01HQZX8QJKMNPQRST9VWXY012',
        paymentEventId: 'pe_01HQZX8QJKMNPQRST9VWXY012',
        status: 'CAPTURED',
        amount: 9900,
        processedAt: new Date(),
      };

      recurringPaymentService.processRecurringPayment.mockResolvedValue(mockResponse);

      // When
      const result = await controller.processRecurringPayment(mockRequest);

      // Then
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('paymentEventId');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('processedAt');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.transactionId).toBe('string');
      expect(typeof result.amount).toBe('number');
    });

    it('validatePaymentMethod 응답이 올바른 형식이어야 함', async () => {
      // Given
      const mockRequest: PaymentMethodValidationRequestDto = {
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        userId: 'user_123456789',
      };

      const mockResponse: PaymentMethodValidationResponseDto = {
        isValid: true,
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      };

      recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

      // When
      const result = await controller.validatePaymentMethod(mockRequest);

      // Then
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('paymentMethodId');
      expect(result).toHaveProperty('methodType');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('paymentPurpose');
      expect(typeof result.isValid).toBe('boolean');
      expect(typeof result.paymentMethodId).toBe('string');
      expect(['SUBSCRIPTION', 'PURCHASE', 'BOTH']).toContain(result.paymentPurpose);
    });
  });

  describe('추가 검증 시나리오', () => {
    it('expectedAmount와 performDetailedValidation 파라미터 전달 확인', async () => {
      // Given
      const mockRequest: PaymentMethodValidationRequestDto = {
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        userId: 'user_123456789',
        expectedAmount: 5000,
        performDetailedValidation: false,
      };

      const mockResponse: PaymentMethodValidationResponseDto = {
        isValid: true,
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        methodType: 'BNPL',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
        validationDetails: {
          detailedValidation: false,
        },
      };

      recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

      // When
      const result = await controller.validatePaymentMethod(mockRequest);

      // Then
      expect(result).toEqual(mockResponse);
      expect(recurringPaymentService.validatePaymentMethodForSubscription).toHaveBeenCalledWith(
        mockRequest.paymentMethodId,
        mockRequest.userId,
        mockRequest.expectedAmount,
        mockRequest.performDetailedValidation,
      );
    });

    it('BNPL 한도 부족 검증 실패', async () => {
      // Given
      const mockRequest: PaymentMethodValidationRequestDto = {
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        userId: 'user_123456789',
        expectedAmount: 100000,
        performDetailedValidation: true,
      };

      const mockResponse: PaymentMethodValidationResponseDto = {
        isValid: false,
        paymentMethodId: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        methodType: 'BNPL',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
        error: 'BNPL 계정의 사용 가능한 한도가 부족합니다.',
        validationDetails: {
          reason: 'INSUFFICIENT_BNPL_CREDIT',
          availableCredit: 50000,
          requiredAmount: 100000,
        },
      };

      recurringPaymentService.validatePaymentMethodForSubscription.mockResolvedValue(mockResponse);

      // When
      const result = await controller.validatePaymentMethod(mockRequest);

      // Then
      expect(result).toEqual(mockResponse);
      expect(result.isValid).toBe(false);
      expect(result.validationDetails?.reason).toBe('INSUFFICIENT_BNPL_CREDIT');
    });
  });
});