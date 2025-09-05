import { Test, TestingModule } from '@nestjs/testing';
import { BnplLedgerService } from '../bnpl-ledger.service';
import { DbService } from '@app/db';

describe('BnplLedgerService', () => {
  let service: BnplLedgerService;
  let mockDb: jest.Mocked<DbService<any>>;
  let mockTransaction: jest.Mock;
  let mockSelect: jest.Mock;
  let mockInsert: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(async () => {
    mockSelect = jest.fn();
    mockInsert = jest.fn();
    mockUpdate = jest.fn();
    mockTransaction = jest.fn();

    mockDb = {
      db: {
        transaction: mockTransaction,
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue(mockSelect),
            }),
          }),
        }),
        insert: jest.fn().mockReturnValue({
          values: jest.fn().mockReturnValue(mockInsert),
        }),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue(mockUpdate),
          }),
        }),
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [BnplLedgerService, { provide: DbService, useValue: mockDb }],
    }).compile();

    service = module.get<BnplLedgerService>(BnplLedgerService);
  });

  describe('authorize', () => {
    it('충분한 한도가 있으면 승인을 성공해야 함', async () => {
      const mockBnplAccount = {
        id: 'bnpl-123',
        status: 'ACTIVE',
        approvedLimit: 100000, // 10만원 한도
      };

      // 트랜잭션 내부 로직을 모킹
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockBnplAccount]),
              }),
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

      const result = await service.authorize('bnpl-123', 50000, 'session-123');

      expect(result.success).toBe(true);
      expect(result.authorizationId).toBeDefined();
      expect(result.remainingLimit).toBe(50000); // 10만원 - 5만원 = 5만원
    });

    it('한도가 부족하면 승인을 거부해야 함', async () => {
      const mockBnplAccount = {
        id: 'bnpl-123',
        status: 'ACTIVE',
        approvedLimit: 30000, // 3만원 한도
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockBnplAccount]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.authorize('bnpl-123', 50000, 'session-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('잔여 한도가 부족합니다');
      expect(result.remainingLimit).toBe(30000);
    });

    it('계정이 비활성화되어 있으면 승인을 거부해야 함', async () => {
      const mockBnplAccount = {
        id: 'bnpl-123',
        status: 'INACTIVE',
        approvedLimit: 100000,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockBnplAccount]),
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.authorize('bnpl-123', 50000, 'session-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'BNPL 계정을 찾을 수 없거나 비활성화 상태입니다',
      );
    });

    it('계정을 찾을 수 없으면 승인을 거부해야 함', async () => {
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // 계정 없음
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.authorize('bnpl-123', 50000, 'session-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'BNPL 계정을 찾을 수 없거나 비활성화 상태입니다',
      );
    });
  });

  describe('batchCapture', () => {
    it('승인된 트랜잭션들을 캡처 상태로 변경해야 함', async () => {
      const mockAuthorizedTransactions = [
        { id: 'tx-1', amount: 10000 },
        { id: 'tx-2', amount: 20000 },
        { id: 'tx-3', amount: 15000 },
      ];

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(mockAuthorizedTransactions),
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.batchCapture(
        'bnpl-123',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
      );

      expect(result.success).toBe(true);
      expect(result.capturedAmount).toBe(45000); // 1만 + 2만 + 1.5만 = 4.5만
      expect(result.captureId).toBeDefined();
    });

    it('승인된 트랜잭션이 없으면 빈 결과를 반환해야 함', async () => {
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]), // 승인된 트랜잭션 없음
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.batchCapture(
        'bnpl-123',
        new Date('2024-01-01'),
        new Date('2024-01-31'),
      );

      expect(result.success).toBe(true);
      expect(result.capturedAmount).toBe(0);
      expect(result.captureId).toBe('');
    });
  });

  describe('refundLocal', () => {
    it('원본 트랜잭션을 찾아서 환불을 처리해야 함', async () => {
      const mockOriginalTransaction = {
        id: 'tx-123',
        bnplAccountId: 'bnpl-456',
        paymentSessionId: 'session-789',
        amount: 50000,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOriginalTransaction]),
              }),
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

      const result = await service.refundLocal('tx-123', 30000);

      expect(result.success).toBe(true);
      expect(result.refundedAmount).toBe(30000);
      expect(result.refundId).toBeDefined();
    });

    it('원본 트랜잭션을 찾을 수 없으면 환불을 거부해야 함', async () => {
      mockTransaction.mockImplementation(async (callback) => {
        const tx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // 원본 트랜잭션 없음
              }),
            }),
          }),
        };
        return await callback(tx);
      });

      const result = await service.refundLocal('tx-123', 30000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('원본 BNPL 트랜잭션을 찾을 수 없습니다');
    });
  });

  describe('getAccountStatus', () => {
    it('계정 상태 정보를 반환해야 함', async () => {
      const mockBnplAccount = {
        id: 'bnpl-123',
        status: 'ACTIVE',
        creditLimit: 500000,
        approvedLimit: 300000,
      };

      mockDb.db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockBnplAccount]),
          }),
        }),
      });

      const result = await service.getAccountStatus('bnpl-123');

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.creditLimit).toBe(500000);
      expect(result.approvedLimit).toBe(300000);
    });

    it('계정을 찾을 수 없으면 에러를 반환해야 함', async () => {
      mockDb.db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]), // 계정 없음
          }),
        }),
      });

      const result = await service.getAccountStatus('bnpl-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('BNPL 계정을 찾을 수 없습니다');
    });
  });
});
