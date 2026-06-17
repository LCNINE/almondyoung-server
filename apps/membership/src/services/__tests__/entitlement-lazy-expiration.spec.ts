import { Test, TestingModule } from '@nestjs/testing';
import { EntitlementService } from '../entitlement.service';
import { EntitlementReader } from '../entitlement/entitlement.reader';
import { EntitlementManager } from '../entitlement/entitlement.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';

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

  const mockReader = {
    findActiveEntitlement: jest.fn(),
  };

  const mockManager = {
    adjustEntitlement: jest.fn(),
    expireEntitlement: jest.fn(),
  };

  const mockMembershipEventPublisher = {
    publishStatusChanged: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        {
          provide: EntitlementReader,
          useValue: mockReader,
        },
        {
          provide: EntitlementManager,
          useValue: mockManager,
        },
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: MembershipEventPublisher,
          useValue: mockMembershipEventPublisher,
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
      mockReader.findActiveEntitlement.mockResolvedValue(null);

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

      mockReader.findActiveEntitlement.mockResolvedValue({
        id: 'entitlement_001',
        endsAt: tomorrowStr,
      });

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

      mockReader.findActiveEntitlement.mockResolvedValue({
        id: 'entitlement_001',
        endsAt: yesterdayStr,
      });

      mockManager.expireEntitlement.mockResolvedValue(undefined);

      // When
      const result = await service.checkAndUpdateSubscription(userId);

      // Then
      expect(result).toBe(false);
      expect(mockManager.expireEntitlement).toHaveBeenCalledWith('entitlement_001', userId);
    });

    it('만료 처리 시 Manager의 expireEntitlement를 호출해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      mockReader.findActiveEntitlement.mockResolvedValue({
        id: 'entitlement_001',
        endsAt: yesterdayStr,
      });

      mockManager.expireEntitlement.mockResolvedValue(undefined);

      // When
      await service.checkAndUpdateSubscription(userId);

      // Then
      expect(mockManager.expireEntitlement).toHaveBeenCalledWith('entitlement_001', userId);
    });
  });

  describe('adjustEntitlement', () => {
    it('권한 조정 성공 후 RESUMED 상태 변경 이벤트를 발행해야 함', async () => {
      const userId = 'test_user_001';
      const adjustedEntitlement = {
        id: 'entitlement_002',
        userId,
        tierId: 'tier_001',
        startsAt: '2026-06-16',
        endsAt: '2026-06-26',
        isCurrent: true,
      };

      mockManager.adjustEntitlement.mockResolvedValue(adjustedEntitlement);
      mockMembershipEventPublisher.publishStatusChanged.mockResolvedValue(undefined);

      const result = await service.adjustEntitlement(userId, 1, '동기화 오류 복구', 'admin_001');

      expect(result).toBe(adjustedEntitlement);
      expect(mockManager.adjustEntitlement).toHaveBeenCalledWith(userId, 1, '동기화 오류 복구', 'admin_001');
      expect(mockMembershipEventPublisher.publishStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          status: 'RESUMED',
          tierId: 'tier_001',
          reasonCode: 'ENTITLEMENT_ADJUSTED',
          reasonText: '동기화 오류 복구',
        }),
      );
    });
  });
});
