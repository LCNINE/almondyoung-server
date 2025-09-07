import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { RecurringPaymentService } from '../recurring-payment.service';
import { PaymentService } from '../payment.service';
import { PaymentMethodService } from '../payment-method.service';
import { RecurringPaymentRequestDto } from '../../shared/dtos/recurring-payment.dto';

describe('RecurringPaymentService - Transaction & Concurrency Control', () => {
  let service: RecurringPaymentService;
  let dbService: DbService<typeof schema>;
  let paymentService: PaymentService;
  let paymentMethodService: PaymentMethodService;

  const mockDbService = {
    db: {
      transaction: jest.fn(),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              id: 'pm123',
              userId: 'user123',
              methodType: 'CARD',
              status: 'ACTIVE',
              paymentPurpose: 'SUBSCRIPTION',
            }]),
          }),
        }),
      }),
      insert: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockPaymentService = {
    processPayment: jest.fn(),
  };

  const mockPaymentMethodService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
      ],
    }).compile();

    service = module.get<RecurringPaymentService>(RecurringPaymentService);
    dbService = module.get<DbService<typeof schema>>(DbService);
    paymentService = module.get<PaymentService>(PaymentService);
    paymentMethodService = module.get<PaymentMethodService>(PaymentMethodService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processRecurringPayment - Atomic Transaction', () => {
    const mockRequest: RecurringPaymentRequestDto = {
      userId: 'user123',
      paymentMethodId: 'pm123',
      amount: 10000,
      currency: 'KRW',
      subscriptionType: 'monthly',
    };

    const mockValidationResult = {
      isValid: true,
      paymentMethodId: 'pm123',
      methodType: 'CARD',
      status: 'ACTIVE',
      paymentPurpose: 'SUBSCRIPTION' as const,
      hmsMemberId: 'hms123',
    };

    const mockPaymentResult = {
      success: true,
      transactionId: 'txn123',
      status: 'CAPTURED',
      metadata: { approvalNumber: 'APPR123' },
    };

    beforeEach(() => {
      // Mock payment method validation
      mockPaymentMethodService.get.mockResolvedValue({
        id: 'pm123',
        userId: 'user123',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      });

      // Mock payment processing
      mockPaymentService.processPayment.mockResolvedValue(mockPaymentResult);

      // Mock the private getCardMethod method
      jest.spyOn(service as any, 'getCardMethod').mockResolvedValue({
        id: 'pm123',
        hmsMemberId: 'hms123',
        maskedCardNumber: '****-****-****-1234',
      });

      // Mock HMS status validation
      jest.spyOn(service as any, 'validateHmsMemberStatus').mockResolvedValue({
        isValid: true,
        validationDetails: { hmsStatus: '신청완료' },
      });
    });

    it('should process recurring payment within atomic transaction', async () => {
      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  id: 'pm123',
                  userId: 'user123',
                  status: 'ACTIVE',
                  paymentPurpose: 'SUBSCRIPTION',
                }]),
              }),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      };

      // Mock transaction callback
      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      // Mock getPaymentEventIdInTransaction
      mockTx.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'pe123' }]),
          }),
        }),
      });

      const result = await service.processRecurringPayment(mockRequest);

      expect(mockDbService.db.transaction).toHaveBeenCalledTimes(1);
      expect(mockPaymentService.processPayment).toHaveBeenCalledWith(
        'CARD',
        10000,
        'KRW',
        expect.objectContaining({
          userId: 'user123',
          paymentMethodId: 'pm123',
          hmsMemberId: 'hms123',
          recurringContext: expect.objectContaining({
            isRecurring: true,
            subscriptionType: 'monthly',
            originalAmount: 10000,
          }),
        }),
        undefined
      );

      expect(result).toEqual({
        success: true,
        transactionId: 'txn123',
        paymentEventId: 'pe123',
        status: 'CAPTURED',
        amount: 10000,
        processedAt: expect.any(Date),
        gatewayResponse: { approvalNumber: 'APPR123' },
      });
    });

    it('should acquire payment method lock with SELECT FOR UPDATE', async () => {
      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  id: 'pm123',
                  userId: 'user123',
                  status: 'ACTIVE',
                  paymentPurpose: 'SUBSCRIPTION',
                }]),
              }),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      // Mock getPaymentEventIdInTransaction
      mockTx.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'pe123' }]),
          }),
        }),
      });

      await service.processRecurringPayment(mockRequest);

      // Verify SELECT FOR UPDATE was called
      expect(mockTx.select).toHaveBeenCalled();
      const selectChain = mockTx.select().from().where();
      expect(selectChain.for).toHaveBeenCalledWith('update');
    });

    it('should handle deadlock and throw ConflictException', async () => {
      const deadlockError = new Error('deadlock detected') as any;
      deadlockError.code = '40P01';

      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockRejectedValue(deadlockError),
              }),
            }),
          }),
        }),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      await expect(service.processRecurringPayment(mockRequest))
        .rejects
        .toThrow(ConflictException);
    });

    it('should validate payment method status after acquiring lock', async () => {
      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  id: 'pm123',
                  userId: 'user123',
                  status: 'INACTIVE', // 비활성화된 상태
                  paymentPurpose: 'SUBSCRIPTION',
                }]),
              }),
            }),
          }),
        }),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      await expect(service.processRecurringPayment(mockRequest))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should validate payment purpose after acquiring lock', async () => {
      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  id: 'pm123',
                  userId: 'user123',
                  status: 'ACTIVE',
                  paymentPurpose: 'PURCHASE', // 구독 결제 불가
                }]),
              }),
            }),
          }),
        }),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      await expect(service.processRecurringPayment(mockRequest))
        .rejects
        .toThrow(BadRequestException);
    });

    it('should update payment event metadata within transaction', async () => {
      const mockTx = {
        select: jest.fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                for: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{
                    id: 'pm123',
                    userId: 'user123',
                    status: 'ACTIVE',
                    paymentPurpose: 'SUBSCRIPTION',
                  }]),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ id: 'pe123' }]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  metadata: JSON.stringify({ existingData: 'test' }),
                }]),
              }),
            }),
          }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      await service.processRecurringPayment(mockRequest);

      // Verify metadata update was called
      expect(mockTx.update).toHaveBeenCalled();
      const updateCall = mockTx.update().set;
      expect(updateCall).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.stringContaining('isSubscriptionPayment'),
          updatedAt: expect.any(Date),
        })
      );
    });
  });

  describe('processRecurringPaymentWithRetry - Retry Logic', () => {
    const mockRequest: RecurringPaymentRequestDto = {
      userId: 'user123',
      paymentMethodId: 'pm123',
      amount: 10000,
      currency: 'KRW',
      subscriptionType: 'monthly',
    };

    beforeEach(() => {
      // Mock validation
      mockPaymentMethodService.get.mockResolvedValue({
        id: 'pm123',
        userId: 'user123',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      });

      // Mock successful payment result
      mockPaymentService.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'txn123',
        status: 'CAPTURED',
        metadata: {},
      });

      // Mock the private methods for retry tests
      jest.spyOn(service as any, 'getCardMethod').mockResolvedValue({
        id: 'pm123',
        hmsMemberId: 'hms123',
        maskedCardNumber: '****-****-****-1234',
      });

      jest.spyOn(service as any, 'validateHmsMemberStatus').mockResolvedValue({
        isValid: true,
        validationDetails: { hmsStatus: '신청완료' },
      });
    });

    it('should retry on deadlock error', async () => {
      const deadlockError = new Error('deadlock detected') as any;
      deadlockError.code = '40P01';

      const mockTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn()
                  .mockRejectedValueOnce(deadlockError) // First attempt fails
                  .mockResolvedValue([{ // Second attempt succeeds
                    id: 'pm123',
                    userId: 'user123',
                    status: 'ACTIVE',
                    paymentPurpose: 'SUBSCRIPTION',
                  }]),
              }),
            }),
          }),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }),
      };

      // Mock getPaymentEventIdInTransaction for successful retry
      mockTx.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'pe123' }]),
          }),
        }),
      });

      mockDbService.db.transaction
        .mockRejectedValueOnce(deadlockError) // First transaction fails
        .mockImplementation(async (callback) => { // Second transaction succeeds
          return await callback(mockTx);
        });

      const result = await service.processRecurringPaymentWithRetry(mockRequest, undefined, 3);

      expect(mockDbService.db.transaction).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('should fail after max retries', async () => {
      const deadlockError = new Error('deadlock detected') as any;
      deadlockError.code = '40P01';

      mockDbService.db.transaction.mockRejectedValue(deadlockError);

      await expect(service.processRecurringPaymentWithRetry(mockRequest, undefined, 2))
        .rejects
        .toThrow('deadlock detected');

      expect(mockDbService.db.transaction).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const validationError = new BadRequestException('Invalid payment method');

      mockPaymentMethodService.get.mockRejectedValue(validationError);

      await expect(service.processRecurringPaymentWithRetry(mockRequest, undefined, 3))
        .rejects
        .toThrow(BadRequestException);

      // Should not retry validation errors
      expect(mockPaymentMethodService.get).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff for retries', async () => {
      const deadlockError = new Error('serialization failure') as any;
      deadlockError.code = '40001';

      mockDbService.db.transaction.mockRejectedValue(deadlockError);

      const startTime = Date.now();
      
      try {
        await service.processRecurringPaymentWithRetry(mockRequest, undefined, 3);
      } catch (error) {
        // Expected to fail after retries
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should have waited for exponential backoff (1000ms + 2000ms = 3000ms minimum)
      expect(duration).toBeGreaterThan(2500); // Allow some tolerance
      expect(mockDbService.db.transaction).toHaveBeenCalledTimes(3);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable PostgreSQL error codes', () => {
      const deadlockError = new Error('deadlock') as any;
      deadlockError.code = '40P01';

      const serializationError = new Error('serialization failure') as any;
      serializationError.code = '40001';

      const connectionError = new Error('connection failed') as any;
      connectionError.code = '08006';

      // Use reflection to access private method for testing
      const isRetryable = (service as any).isRetryableError.bind(service);

      expect(isRetryable(deadlockError)).toBe(true);
      expect(isRetryable(serializationError)).toBe(true);
      expect(isRetryable(connectionError)).toBe(true);
    });

    it('should identify retryable error messages', () => {
      const deadlockMessage = new Error('Transaction deadlock detected');
      const timeoutMessage = new Error('Connection timeout occurred');
      const concurrencyMessage = new Error('동시 결제 요청으로 인한 충돌이 발생했습니다');

      const isRetryable = (service as any).isRetryableError.bind(service);

      expect(isRetryable(deadlockMessage)).toBe(true);
      expect(isRetryable(timeoutMessage)).toBe(true);
      expect(isRetryable(concurrencyMessage)).toBe(true);
    });

    it('should not retry business logic errors', () => {
      const validationError = new BadRequestException('Invalid payment method');
      const notFoundError = new Error('Payment method not found');

      const isRetryable = (service as any).isRetryableError.bind(service);

      expect(isRetryable(validationError)).toBe(false);
      expect(isRetryable(notFoundError)).toBe(false);
    });
  });
});