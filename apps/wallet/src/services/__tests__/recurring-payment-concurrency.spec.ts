import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { RecurringPaymentService } from '../recurring-payment.service';
import { DbService } from '@app/db';
import { PaymentService } from '../payment.service';
import { PaymentMethodService } from '../payment-method.service';
import { RecurringPaymentLoggerService } from '../recurring-payment-logger.service';
import * as schema from '../../shared/database/schema';
import { RecurringPaymentRequestDto } from '../../shared/dtos/recurring-payment.dto';

/**
 * 구독 결제 동시성 제어 및 재시도 로직 테스트
 */
describe('RecurringPaymentService - Concurrency Control', () => {
  let service: RecurringPaymentService;
  let paymentService: jest.Mocked<PaymentService>;
  let paymentMethodService: jest.Mocked<PaymentMethodService>;
  let dbService: jest.Mocked<DbService<typeof schema>>;
  let module: TestingModule;

  beforeEach(async () => {
    const mockDbService = {
      db: {
        transaction: jest.fn(),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue([]),
      },
    };

    const mockPaymentService = {
      processPayment: jest.fn(),
      getMemberStatus: jest.fn(),
    };

    const mockPaymentMethodService = {
      get: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        RecurringPaymentService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: PaymentService,
          useValue: mockPaymentService,
        },
        {
          provide: PaymentMethodService,
          useValue: mockPaymentMethodService,
        },
        {
          provide: RecurringPaymentLoggerService,
          useValue: {
            logPaymentRequestStart: jest.fn(),
            logPaymentSuccess: jest.fn(),
            logPaymentError: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RecurringPaymentService>(RecurringPaymentService);
    paymentService = module.get<PaymentService>(PaymentService) as jest.Mocked<PaymentService>;
    paymentMethodService = module.get<PaymentMethodService>(PaymentMethodService) as jest.Mocked<PaymentMethodService>;
    dbService = module.get<DbService<typeof schema>>(DbService) as jest.Mocked<DbService<typeof schema>>;
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  describe('재시도 로직 테스트', () => {
    const mockRequest: RecurringPaymentRequestDto = {
      userId: 'user_123456789',
      paymentMethodId: 'pm_card_subscription',
      amount: 9900,
      currency: 'KRW',
      subscriptionType: 'monthly',
    };

    it('재시도 가능한 에러 판별이 올바르게 작동해야 함', () => {
      // Given
      const deadlockError = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      const serializationError = Object.assign(new Error('serialization failure'), { code: '40001' });
      const connectionError = Object.assign(new Error('connection timeout'), { code: '08006' });
      const businessError = new BadRequestException('잘못된 결제수단');

      // When & Then
      expect(service['isRetryableError'](deadlockError)).toBe(true);
      expect(service['isRetryableError'](serializationError)).toBe(true);
      expect(service['isRetryableError'](connectionError)).toBe(true);
      expect(service['isRetryableError'](businessError)).toBe(false);
    });

    it('최대 재시도 횟수 초과 시 마지막 에러를 던져야 함', async () => {
      // Given
      const deadlockError = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      
      jest.spyOn(service, 'processRecurringPayment')
        .mockRejectedValue(deadlockError);

      // When & Then
      await expect(
        service.processRecurringPaymentWithRetry(mockRequest, undefined, 2)
      ).rejects.toThrow('deadlock detected');
    });

    it('재시도 불가능한 에러는 즉시 던져야 함', async () => {
      // Given
      const businessError = new BadRequestException('잘못된 결제수단');
      
      jest.spyOn(service, 'processRecurringPayment')
        .mockRejectedValue(businessError);

      // When & Then
      await expect(
        service.processRecurringPaymentWithRetry(mockRequest, undefined, 3)
      ).rejects.toThrow(BadRequestException);
    });

    it('재시도 성공 시 결과를 반환해야 함', async () => {
      // Given
      const deadlockError = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      const successResult = {
        success: true,
        transactionId: 'txn_success_after_retry',
        paymentEventId: 'pe_success',
        status: 'CAPTURED' as const,
        amount: 9900,
        processedAt: new Date(),
      };

      jest.spyOn(service, 'processRecurringPayment')
        .mockRejectedValueOnce(deadlockError)
        .mockResolvedValueOnce(successResult);

      // When
      const result = await service.processRecurringPaymentWithRetry(mockRequest, undefined, 3);

      // Then
      expect(result).toEqual(successResult);
    });
  });

  describe('동시성 제어 테스트', () => {
    it('SELECT FOR UPDATE 잠금이 올바르게 적용되어야 함', async () => {
      // Given
      const mockTx = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        for: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{
          id: 'pm_card_subscription',
          userId: 'user_123456789',
          status: 'ACTIVE',
          paymentPurpose: 'SUBSCRIPTION',
        }]),
      };

      // When
      await service['acquirePaymentMethodLock'](mockTx as any, 'pm_card_subscription', 'user_123456789');

      // Then
      expect(mockTx.for).toHaveBeenCalledWith('update');
    });

    it('데드락 발생 시 ConflictException을 던져야 함', async () => {
      // Given
      const mockTx = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        for: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(
          Object.assign(new Error('deadlock detected'), { code: '40P01' })
        ),
      };

      // When & Then
      await expect(
        service['acquirePaymentMethodLock'](mockTx as any, 'pm_card_subscription', 'user_123456789')
      ).rejects.toThrow(ConflictException);
    });
  });
});