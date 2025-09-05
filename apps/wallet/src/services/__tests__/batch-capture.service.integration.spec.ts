import { Test, TestingModule } from '@nestjs/testing';
import { BatchCaptureService } from '../batch-capture.service';
import { DbService } from '@app/db';
import { PaymentStrategyFactory } from '../../factories/payment-strategy.factory';
import { IdempotencyService } from '../idempotency.service';
import { BnplLedgerService } from '../bnpl-ledger.service';

describe('BatchCaptureService Integration', () => {
  let service: BatchCaptureService;
  let mockDb: jest.Mocked<DbService<any>>;
  let mockStrategyFactory: jest.Mocked<PaymentStrategyFactory>;
  let mockIdempotency: jest.Mocked<IdempotencyService>;
  let mockBnplLedger: jest.Mocked<BnplLedgerService>;

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
    } as any;

    mockIdempotency = {
      checkOrCreate: jest.fn(),
      complete: jest.fn(),
    } as any;

    mockBnplLedger = {
      batchCapture: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchCaptureService,
        { provide: DbService, useValue: mockDb },
        { provide: PaymentStrategyFactory, useValue: mockStrategyFactory },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: BnplLedgerService, useValue: mockBnplLedger },
      ],
    }).compile();

    service = module.get<BatchCaptureService>(BatchCaptureService);
  });

  describe('createAndExecuteBnplSettlementBatch', () => {
    it('BNPL 정산 배치 전체 플로우가 정상 작동해야 함', async () => {
      const bnplAccountId = 'bnpl-123';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');
      const idempotencyKey = 'batch-idem-123';

      // Mock 승인된 트랜잭션들
      const mockTransactions = [
        { id: 'tx-1', amount: 10000, createdAt: new Date('2024-01-15') },
        { id: 'tx-2', amount: 25000, createdAt: new Date('2024-01-20') },
        { id: 'tx-3', amount: 15000, createdAt: new Date('2024-01-25') },
      ];

      // Mock BNPL Strategy
      const mockBnplStrategy = {
        batchCapture: jest.fn().mockResolvedValue({
          success: true,
          captureIds: ['capture-1', 'capture-2', 'capture-3'],
          failedIds: [],
        }),
      };

      mockStrategyFactory.getStrategy.mockReturnValue(mockBnplStrategy);

      // Mock transaction 실행
      mockDb.db.transaction.mockImplementation(async (callback) => {
        const tx = {
          // 1. 멱등성 체크 (신규 요청)
          checkOrCreate: mockIdempotency.checkOrCreate.mockResolvedValue({
            hit: false,
          }),

          // 2. 승인된 트랜잭션 조회
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(mockTransactions),
            }),
          }),

          // 3. 정산 배치 생성
          insert: jest.fn().mockImplementation((table) => ({
            values: jest.fn().mockResolvedValue(undefined),
          })),

          // 4. 배치 상태 업데이트
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return await callback(tx);
      });

      // Mock 내부 원장 업데이트
      mockBnplLedger.batchCapture.mockResolvedValue({
        success: true,
        capturedAmount: 50000,
        captureId: 'batch-capture-123',
      });

      // Mock 멱등성 완료
      mockIdempotency.complete.mockResolvedValue(undefined);

      const result = await service.createAndExecuteBnplSettlementBatch(
        bnplAccountId,
        periodStart,
        periodEnd,
        idempotencyKey,
      );

      // 검증
      expect(result.success).toBe(true);
      expect(result.batchId).toBeDefined();
      expect(result.totalAmount).toBe(50000); // 1만 + 2.5만 + 1.5만
      expect(result.processedCount).toBe(3);
      expect(result.failedCount).toBe(0);

      // Strategy 호출 검증
      expect(mockStrategyFactory.getStrategy).toHaveBeenCalledWith('BNPL');
      expect(mockBnplStrategy.batchCapture).toHaveBeenCalledWith([
        'tx-1',
        'tx-2',
        'tx-3',
      ]);

      // 내부 원장 업데이트 검증
      expect(mockBnplLedger.batchCapture).toHaveBeenCalledWith(
        bnplAccountId,
        periodStart,
        periodEnd,
      );

      // 멱등성 완료 검증
      expect(mockIdempotency.complete).toHaveBeenCalledWith(
        expect.anything(),
        idempotencyKey,
        result,
        200,
      );
    });

    it('승인된 트랜잭션이 없으면 빈 배치를 반환해야 함', async () => {
      const bnplAccountId = 'bnpl-123';
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      mockDb.db.transaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]), // 승인된 트랜잭션 없음
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.createAndExecuteBnplSettlementBatch(
        bnplAccountId,
        periodStart,
        periodEnd,
      );

      expect(result.success).toBe(true);
      expect(result.totalAmount).toBe(0);
      expect(result.processedCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it('일부 트랜잭션이 실패해도 배치는 완료되어야 함', async () => {
      const mockTransactions = [
        { id: 'tx-1', amount: 10000, createdAt: new Date('2024-01-15') },
        { id: 'tx-2', amount: 25000, createdAt: new Date('2024-01-20') },
      ];

      // Mock BNPL Strategy - 일부 실패
      const mockBnplStrategy = {
        batchCapture: jest.fn().mockResolvedValue({
          success: true,
          captureIds: ['capture-1'], // tx-1만 성공
          failedIds: ['tx-2'], // tx-2는 실패
        }),
      };

      mockStrategyFactory.getStrategy.mockReturnValue(mockBnplStrategy);

      mockDb.db.transaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(mockTransactions),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue(undefined),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return await callback(tx);
      });

      mockBnplLedger.batchCapture.mockResolvedValue({
        success: true,
        capturedAmount: 10000,
        captureId: 'batch-capture-partial',
      });

      const result = await service.createAndExecuteBnplSettlementBatch(
        'bnpl-123',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
      );

      expect(result.success).toBe(true);
      expect(result.processedCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });

    it('멱등성 키가 있고 이미 처리된 요청이면 캐시된 결과를 반환해야 함', async () => {
      const cachedResult = {
        success: true,
        batchId: 'cached-batch-123',
        totalAmount: 75000,
        processedCount: 3,
        failedCount: 0,
      };

      mockDb.db.transaction.mockImplementation(async (callback) => {
        const tx = {};
        return await callback(tx);
      });

      mockIdempotency.checkOrCreate.mockResolvedValue({
        hit: true,
        response: cachedResult,
      });

      const result = await service.createAndExecuteBnplSettlementBatch(
        'bnpl-123',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        'cached-idem-key',
      );

      expect(result).toEqual(cachedResult);
      expect(mockStrategyFactory.getStrategy).not.toHaveBeenCalled(); // Strategy 호출 안됨
    });
  });

  describe('getSettlementBatchStatus', () => {
    it('정산 배치 상태와 관련 정보들을 조회해야 함', async () => {
      const batchId = 'batch-123';
      const mockBatch = {
        id: batchId,
        status: 'COMPLETED',
        totalAmount: 50000,
      };
      const mockItems = [
        { id: 'item-1', amount: 20000 },
        { id: 'item-2', amount: 30000 },
      ];
      const mockEvents = [
        { eventType: 'BATCH_STARTED', status: 'PROCESSING' },
        { eventType: 'BATCH_COMPLETED', status: 'CAPTURED' },
      ];

      // Mock 배치 조회
      mockDb.db.select = jest
        .fn()
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockBatch]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockItems),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockEvents),
          }),
        });

      const result = await service.getSettlementBatchStatus(batchId);

      expect(result.success).toBe(true);
      expect(result.batch).toEqual(mockBatch);
      expect(result.items).toEqual(mockItems);
      expect(result.events).toEqual(mockEvents);
    });
  });
});
