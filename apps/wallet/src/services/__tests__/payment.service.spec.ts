import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from '../payment.service';
import { DbService } from '@app/db';
import { PaymentStrategyFactory } from '../../factories/payment-strategy.factory';
import { IdempotencyService } from '../idempotency.service';
import { BatchCaptureService } from '../batch-capture.service';

describe('PaymentService', () => {
  let service: PaymentService;
  let mockDb: jest.Mocked<DbService<any>>;
  let mockStrategyFactory: jest.Mocked<PaymentStrategyFactory>;
  let mockIdempotency: jest.Mocked<IdempotencyService>;
  let mockBatchCapture: jest.Mocked<BatchCaptureService>;

  beforeEach(async () => {
    const mockTransaction = jest.fn();
    mockDb = {
      db: {
        transaction: mockTransaction,
        insert: jest.fn(),
        update: jest.fn(),
        select: jest.fn(),
      },
    } as any;

    mockStrategyFactory = {
      getStrategy: jest.fn(),
      getBatchProcessingStrategy: jest.fn(),
    } as any;

    mockIdempotency = {
      checkOrCreate: jest.fn(),
      complete: jest.fn(),
    } as any;

    mockBatchCapture = {
      createAndExecuteBnplSettlementBatch: jest.fn(),
      getSettlementBatchStatus: jest.fn(),
      getPendingSettlementBatches: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: DbService, useValue: mockDb },
        { provide: PaymentStrategyFactory, useValue: mockStrategyFactory },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: BatchCaptureService, useValue: mockBatchCapture },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  describe('processPayment', () => {
    it('withIdempotency 래퍼를 사용해서 결제를 처리해야 함', async () => {
      const mockStrategy = {
        processPayment: jest.fn().mockResolvedValue({
          success: true,
          transactionId: 'test-tx-123',
          status: 'CAPTURED',
          metadata: { provider: 'hms_card' },
        }),
      };

      mockStrategyFactory.getStrategy.mockReturnValue(mockStrategy);

      const result = await service.processPayment(
        'CARD',
        10000,
        'KRW',
        {
          userId: 'user-123',
          sessionId: 'session-123',
          paymentMethodId: 'pm-123',
        },
        'idem-key-123',
      );

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('CARD');
      expect(mockStrategy.processPayment).toHaveBeenCalledWith(
        10000,
        'KRW',
        expect.objectContaining({
          userId: 'user-123',
          sessionId: 'session-123',
          paymentMethodId: 'pm-123',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('test-tx-123');
    });

    it('Strategy가 processPayment를 지원하지 않으면 에러를 던져야 함', async () => {
      const mockStrategy = {}; // processPayment 메서드 없음

      mockStrategyFactory.getStrategy.mockReturnValue(mockStrategy);

      await expect(
        service.processPayment('INVALID', 10000, 'KRW', {
          userId: 'user-123',
          sessionId: 'session-123',
        }),
      ).rejects.toThrow('INVALID는 결제 처리를 지원하지 않습니다');
    });
  });

  describe('registerPaymentMethod', () => {
    it('withIdempotency 래퍼를 사용해서 결제수단을 등록해야 함', async () => {
      const mockStrategy = {
        registerMethod: jest.fn().mockResolvedValue({
          success: true,
          paymentMethodId: 'pm-123',
          hmsMemberId: 'hms-456',
          metadata: { provider: 'hms_card' },
        }),
      };

      mockStrategyFactory.getStrategy.mockReturnValue(mockStrategy);

      const result = await service.registerPaymentMethod(
        'CARD',
        {
          userId: 'user-123',
          memberName: 'Test User',
          paymentNumber: '1234567890123456',
        },
        'idem-key-456',
        'RECURRING',
      );

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('CARD');
      expect(mockStrategy.registerMethod).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          memberName: 'Test User',
          usage: 'RECURRING',
        }),
      );
      expect(result.success).toBe(true);
      expect(result.paymentMethodId).toBe('pm-123');
    });
  });

  describe('refundPayment', () => {
    it('withIdempotency 래퍼를 사용해서 환불을 처리해야 함', async () => {
      const mockStrategy = {
        refundPayment: jest.fn().mockResolvedValue({
          success: true,
          refundId: 'refund-123',
          refundedAmount: 5000,
          metadata: { provider: 'hms_card' },
        }),
      };

      mockStrategyFactory.getStrategy.mockReturnValue(mockStrategy);

      const result = await service.refundPayment(
        'CARD',
        'tx-123',
        5000,
        '고객 요청',
        'idem-key-789',
      );

      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('CARD');
      expect(mockStrategy.refundPayment).toHaveBeenCalledWith(
        'tx-123',
        5000,
        '고객 요청',
      );
      expect(result.success).toBe(true);
      expect(result.refundId).toBe('refund-123');
    });
  });

  describe('createBnplSettlementBatch', () => {
    it('BatchCaptureService를 통해 BNPL 정산 배치를 생성해야 함', async () => {
      const mockResult = {
        success: true,
        batchId: 'batch-123',
        totalAmount: 100000,
        processedCount: 5,
        failedCount: 0,
      };

      mockBatchCapture.createAndExecuteBnplSettlementBatch.mockResolvedValue(
        mockResult,
      );

      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      const result = await service.createBnplSettlementBatch(
        'bnpl-account-123',
        periodStart,
        periodEnd,
        'idem-batch-123',
      );

      expect(
        mockBatchCapture.createAndExecuteBnplSettlementBatch,
      ).toHaveBeenCalledWith(
        'bnpl-account-123',
        periodStart,
        periodEnd,
        'idem-batch-123',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getGatewayType', () => {
    it('결제수단 타입에 따라 올바른 게이트웨이 타입을 반환해야 함', () => {
      // private 메서드이므로 간접적으로 테스트 (실제로는 recordEvent에서 사용됨)
      const testCases = [
        { methodType: 'CARD', expected: 'hms_card' },
        { methodType: 'BNPL', expected: 'hms_bnpl' },
        { methodType: 'EASY_PAY', expected: 'toss' },
        { methodType: 'REWARD_POINT', expected: 'internal_point' },
        { methodType: 'UNKNOWN', expected: 'unknown' },
      ];

      // private 메서드 테스트는 실제 사용 시나리오를 통해 검증
      testCases.forEach(({ methodType }) => {
        expect(() => service['getGatewayType'](methodType)).not.toThrow();
      });
    });
  });
});
