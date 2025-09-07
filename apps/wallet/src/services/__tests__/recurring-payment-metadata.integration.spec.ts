import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import { RecurringPaymentService } from '../recurring-payment.service';
import { PaymentService } from '../payment.service';
import { PaymentMethodService } from '../payment-method.service';
import { RecurringPaymentLoggerService } from '../recurring-payment-logger.service';

import * as schema from '../../shared/database/schema';

import {
  RecurringPaymentRequestDto,
  PaymentMethodValidationResponseDto,
} from '../../shared/dtos/recurring-payment.dto';

/**
 * 구독 결제 메타데이터 통합 테스트
 * PaymentEvents 테이블에 구독 결제 정보가 올바르게 기록되는지 검증
 */
describe('RecurringPaymentService - Subscription Metadata Integration', () => {
  let service: RecurringPaymentService;
  let paymentService: jest.Mocked<PaymentService>;
  let paymentMethodService: jest.Mocked<PaymentMethodService>;
  let dbService: jest.Mocked<DbService<typeof schema>>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock 데이터베이스 트랜잭션
    const mockTransaction = jest.fn();
    const mockDb = {
      transaction: mockTransaction,
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue([]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnValue([{ id: 'pe_test_event_id' }]),
    };

    const mockDbService = {
      db: mockDb,
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

  describe('구독 결제 메타데이터 기록', () => {
    const mockRequest: RecurringPaymentRequestDto = {
      userId: 'user_123456789',
      paymentMethodId: 'pm_card_subscription',
      amount: 9900,
      currency: 'KRW',
      subscriptionType: 'monthly',
      billingCycle: 30,
      discountAmount: 1000,
      discountMetadata: {
        couponId: 'COUPON123',
        discountRate: 10,
      },
    };

    const mockValidationResult: PaymentMethodValidationResponseDto = {
      isValid: true,
      paymentMethodId: 'pm_card_subscription',
      methodType: 'CARD',
      status: 'ACTIVE',
      paymentPurpose: 'SUBSCRIPTION',
      hmsMemberId: 'HMS_123456789',
    };

    it('구독 결제 시 PaymentService에 올바른 메타데이터가 전달되어야 함', async () => {
      // Given
      paymentMethodService.get.mockResolvedValue({
        id: 'pm_card_subscription',
        userId: 'user_123456789',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      } as any);

      // Mock HMS 상태 검증 성공
      paymentService.getMemberStatus.mockResolvedValue({
        success: true,
        status: 'ACTIVE',
        hmsStatus: '신청완료',
      });

      // Mock 카드 메소드 조회 - 두 번의 select 호출을 위해 순차적으로 설정
      (dbService.db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                hmsMemberId: 'HMS_123456789',
              }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'pe_subscription_event',
              }]),
            }),
          }),
        });

      // Mock PaymentService 결제 처리 성공
      paymentService.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'txn_subscription_test',
        status: 'CAPTURED',
        amount: 9900,
        currency: 'KRW',
        metadata: {
          approvalNumber: 'APPR123456',
        },
      });

      // PaymentEvent ID 조회는 위에서 이미 설정됨

      // When
      const result = await service.processRecurringPayment(mockRequest);

      // Then
      expect(paymentService.processPayment).toHaveBeenCalledWith(
        'CARD',
        9900,
        'KRW',
        expect.objectContaining({
          userId: 'user_123456789',
          paymentMethodId: 'pm_card_subscription',
          hmsMemberId: 'HMS_123456789',
          paymentPurpose: 'SUBSCRIPTION',
          isSubscriptionPayment: true,
          recurringContext: expect.objectContaining({
            isRecurring: true,
            subscriptionType: 'monthly',
            billingCycle: 30,
            originalAmount: 9900,
            discountAmount: 1000,
            discountMetadata: {
              couponId: 'COUPON123',
              discountRate: 10,
            },
          }),
          sessionId: expect.stringMatching(/^recurring_\d+_user_123456789$/),
          requestedAt: expect.any(String),
        }),
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('txn_subscription_test');
      expect(result.paymentEventId).toBe('pe_subscription_event');
    });

    it('BNPL 구독 결제 시 올바른 메타데이터가 전달되어야 함', async () => {
      // Given
      const bnplRequest = {
        ...mockRequest,
        paymentMethodId: 'pm_bnpl_subscription',
      };



      paymentMethodService.get.mockResolvedValue({
        id: 'pm_bnpl_subscription',
        userId: 'user_123456789',
        methodType: 'BNPL',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      } as any);

      // Mock BNPL 계정 조회 - 순차적으로 설정
      (dbService.db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                hmsMemberId: 'HMS_BNPL_123456789',
                approvedLimit: 100000,
              }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'pe_bnpl_subscription_event',
              }]),
            }),
          }),
        });

      // Mock HMS 상태 검증 성공
      paymentService.getMemberStatus.mockResolvedValue({
        success: true,
        status: 'ACTIVE',
        hmsStatus: '신청완료',
      });

      paymentService.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'txn_bnpl_subscription_test',
        status: 'AUTHORIZED',
        amount: 9900,
        currency: 'KRW',
        metadata: {
          authorizationId: 'AUTH123456',
        },
      });

      // When
      const result = await service.processRecurringPayment(bnplRequest);

      // Then
      expect(paymentService.processPayment).toHaveBeenCalledWith(
        'BNPL',
        9900,
        'KRW',
        expect.objectContaining({
          userId: 'user_123456789',
          paymentMethodId: 'pm_bnpl_subscription',
          paymentPurpose: 'SUBSCRIPTION',
          isSubscriptionPayment: true,
          recurringContext: expect.objectContaining({
            isRecurring: true,
            subscriptionType: 'monthly',
          }),
        }),
        undefined,
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('AUTHORIZED');
    });

    it('할인이 없는 구독 결제 시 올바른 메타데이터가 전달되어야 함', async () => {
      // Given
      const requestWithoutDiscount = {
        ...mockRequest,
        discountAmount: undefined,
        discountMetadata: undefined,
      };

      paymentMethodService.get.mockResolvedValue({
        id: 'pm_card_subscription',
        userId: 'user_123456789',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      } as any);

      paymentService.getMemberStatus.mockResolvedValue({
        success: true,
        status: 'ACTIVE',
        hmsStatus: '신청완료',
      });

      (dbService.db.select as jest.Mock)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                hmsMemberId: 'HMS_123456789',
              }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'pe_no_discount_event',
              }]),
            }),
          }),
        });

      paymentService.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'txn_no_discount_test',
        status: 'CAPTURED',
        amount: 9900,
        currency: 'KRW',
      });

      // When
      const result = await service.processRecurringPayment(requestWithoutDiscount);

      // Then
      expect(paymentService.processPayment).toHaveBeenCalledWith(
        'CARD',
        9900,
        'KRW',
        expect.objectContaining({
          recurringContext: expect.objectContaining({
            isRecurring: true,
            subscriptionType: 'monthly',
            originalAmount: 9900,
            discountAmount: undefined,
            discountMetadata: undefined,
          }),
        }),
        undefined,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('PaymentEvents 메타데이터 검증', () => {
    it('getPaymentStatus가 구독 결제 메타데이터를 올바르게 파싱해야 함', async () => {
      // Given
      const mockPaymentEvent = {
        id: 'pe_subscription_event',
        pgTransactionId: 'txn_subscription_test',
        status: 'CAPTURED',
        amount: 9900,
        createdAt: new Date('2024-01-15T10:30:00.000Z'),
        metadata: JSON.stringify({
          gateway: 'hms_card',
          eventType: 'payment',
          isSubscriptionPayment: true,
          subscriptionType: 'monthly',
          billingCycle: 30,
          originalAmount: 9900,
          discountAmount: 1000,
          discountMetadata: {
            couponId: 'COUPON123',
            discountRate: 10,
          },
          paymentPurpose: 'SUBSCRIPTION',
          hmsMemberId: 'HMS_123456789',
        }),
        pgResponse: JSON.stringify({
          gateway: 'hms_card',
          approvalNumber: 'APPR123456',
        }),
      };

      (dbService.db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockPaymentEvent]),
          }),
        }),
      });

      // When
      const result = await service.getPaymentStatus('txn_subscription_test');

      // Then
      expect(result).toEqual({
        transactionId: 'txn_subscription_test',
        paymentEventId: 'pe_subscription_event',
        status: 'CAPTURED',
        amount: 9900,
        currency: 'KRW',
        processedAt: new Date('2024-01-15T10:30:00.000Z'),
        isSubscriptionPayment: true,
        subscriptionType: 'monthly',
        paymentPurpose: 'SUBSCRIPTION',
        gatewayResponse: {
          gateway: 'hms_card',
          approvalNumber: 'APPR123456',
        },
      });
    });

    it('일반 결제 이벤트는 isSubscriptionPayment가 false여야 함', async () => {
      // Given
      const mockRegularPaymentEvent = {
        id: 'pe_regular_event',
        pgTransactionId: 'txn_regular_test',
        status: 'CAPTURED',
        amount: 5000,
        createdAt: new Date('2024-01-15T10:30:00.000Z'),
        metadata: JSON.stringify({
          gateway: 'toss',
          eventType: 'payment',
          // isSubscriptionPayment 필드 없음
        }),
        pgResponse: JSON.stringify({
          gateway: 'toss',
          paymentKey: 'TOSS123456',
        }),
      };

      (dbService.db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockRegularPaymentEvent]),
          }),
        }),
      });

      // When
      const result = await service.getPaymentStatus('txn_regular_test');

      // Then
      expect(result.isSubscriptionPayment).toBe(false);
      expect(result.subscriptionType).toBeUndefined();
      expect(result.paymentPurpose).toBeUndefined();
    });
  });

  });

  describe('에러 시나리오에서의 메타데이터 처리', () => {
    it('결제 실패 시에도 구독 결제 컨텍스트가 전달되어야 함', async () => {
      // Given
      const failureRequest: RecurringPaymentRequestDto = {
        userId: 'user_123456789',
        paymentMethodId: 'pm_card_subscription',
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      paymentMethodService.get.mockResolvedValue({
        id: 'pm_card_subscription',
        userId: 'user_123456789',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      } as any);

      paymentService.getMemberStatus.mockResolvedValue({
        success: true,
        status: 'ACTIVE',
        hmsStatus: '신청완료',
      });

      (dbService.db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              hmsMemberId: 'HMS_123456789',
            }]),
          }),
        }),
      });

      // Mock PaymentService 결제 실패
      paymentService.processPayment.mockRejectedValue(new Error('잔액이 부족합니다'));

      // When & Then
      await expect(service.processRecurringPayment(failureRequest)).rejects.toThrow('잔액이 부족합니다');

      // Then
      expect(paymentService.processPayment).toHaveBeenCalledWith(
        'CARD',
        9900,
        'KRW',
        expect.objectContaining({
          isSubscriptionPayment: true,
          recurringContext: expect.objectContaining({
            isRecurring: true,
            subscriptionType: 'monthly',
          }),
        }),
        undefined,
      );
    });

    it('동시성 제어 실패 시 ConflictException이 발생해야 함', async () => {
      // Given
      const concurrencyRequest: RecurringPaymentRequestDto = {
        userId: 'user_123456789',
        paymentMethodId: 'pm_card_subscription',
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
        billingCycle: 30,
      };

      paymentMethodService.get.mockResolvedValue({
        id: 'pm_card_subscription',
        userId: 'user_123456789',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
      } as any);

      paymentService.getMemberStatus.mockResolvedValue({
        success: true,
        status: 'ACTIVE',
        hmsStatus: '신청완료',
      });

      (dbService.db.select as jest.Mock).mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              hmsMemberId: 'HMS_123456789',
            }]),
          }),
        }),
      });

      // Mock database transaction to simulate deadlock
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                for: jest.fn().mockReturnValue({
                  limit: jest.fn().mockRejectedValue(
                    Object.assign(new Error('deadlock detected'), { code: '40P01' })
                  ),
                }),
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // When & Then
      await expect(service.processRecurringPayment(concurrencyRequest)).rejects.toThrow(ConflictException);
    });

    it('트랜잭션 재시도 로직이 올바르게 작동해야 함', async () => {
      // Given
      const retryRequest: RecurringPaymentRequestDto = {
        userId: 'user_123456789',
        paymentMethodId: 'pm_card_subscription',
        amount: 9900,
        currency: 'KRW',
        subscriptionType: 'monthly',
      };

      // Mock validation success
      jest.spyOn(service, 'validatePaymentMethodForSubscription').mockResolvedValue({
        isValid: true,
        paymentMethodId: 'pm_card_subscription',
        methodType: 'CARD',
        status: 'ACTIVE',
        paymentPurpose: 'SUBSCRIPTION',
        hmsMemberId: 'HMS_123456789',
      });

      // Mock processRecurringPayment to fail twice then succeed
      const processRecurringPaymentSpy = jest.spyOn(service, 'processRecurringPayment')
        .mockRejectedValueOnce(Object.assign(new Error('deadlock detected'), { code: '40001' }))
        .mockRejectedValueOnce(Object.assign(new Error('serialization failure'), { code: '40001' }))
        .mockResolvedValueOnce({
          success: true,
          transactionId: 'txn_retry_success',
          paymentEventId: 'pe_retry_success',
          status: 'CAPTURED',
          amount: 9900,
          processedAt: new Date(),
        });

      // When
      const result = await service.processRecurringPaymentWithRetry(retryRequest, undefined, 3);

      // Then
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('txn_retry_success');
      expect(processRecurringPaymentSpy).toHaveBeenCalledTimes(3); // 2 failures + 1 success
    });
  });
});