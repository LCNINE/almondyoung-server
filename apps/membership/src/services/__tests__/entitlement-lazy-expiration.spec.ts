import { Test, TestingModule } from '@nestjs/testing';
import { EntitlementService } from '../entitlement.service';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PlanService } from '../plan.service';

describe('EntitlementService - Lazy Expiration', () => {
  let service: EntitlementService;
  let dbService: DbService<typeof membershipSchema>;

  const mockDbService = {
    db: {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      transaction: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    },
  };

  const mockPlanService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: PlanService,
          useValue: mockPlanService,
        },
      ],
    }).compile();

    service = module.get<EntitlementService>(EntitlementService);
    dbService = module.get<DbService<typeof membershipSchema>>(DbService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndUpdateSubscription', () => {
    it('활성 구독이 없으면 false를 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      mockDbService.db.limit.mockResolvedValue([]);

      // When
      const result = await service.checkAndUpdateSubscription(userId);

      // Then
      expect(result).toBe(false);
    });

    it('만료되지 않은 구독이 있으면 true를 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      mockDbService.db.limit.mockResolvedValue([
        {
          id: 'entitlement_001',
          endsAt: tomorrowStr,
        },
      ]);

      // When
      const result = await service.checkAndUpdateSubscription(userId);

      // Then
      expect(result).toBe(true);
    });

    it('만료된 구독이 있으면 자동으로 정규화하고 false를 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      mockDbService.db.limit.mockResolvedValueOnce([
        {
          id: 'entitlement_001',
          endsAt: yesterdayStr,
        },
      ]);

      const mockTx = {
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ id: 'batch_001' }]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 'contract_001' }]),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      // When
      const result = await service.checkAndUpdateSubscription(userId);

      // Then
      expect(result).toBe(false);
      expect(mockDbService.db.transaction).toHaveBeenCalled();
    });

    it('만료 처리 시 SUBSCRIPTION_EXPIRED 이벤트 배치를 생성해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      mockDbService.db.limit.mockResolvedValueOnce([
        {
          id: 'entitlement_001',
          endsAt: yesterdayStr,
        },
      ]);

      let capturedValues: any = null;
      const mockTx = {
        insert: jest.fn().mockReturnThis(),
        values: jest.fn((val) => {
          if (!capturedValues) capturedValues = val;
          return mockTx;
        }),
        returning: jest.fn().mockResolvedValue([{ id: 'batch_001' }]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ id: 'contract_001' }]),
      };

      mockDbService.db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTx);
      });

      // When
      await service.checkAndUpdateSubscription(userId);

      // Then
      expect(capturedValues).toMatchObject({
        type: 'SUBSCRIPTION_EXPIRED',
      });
    });
  });
});
