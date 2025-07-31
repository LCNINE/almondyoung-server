import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from './subscription.service';
import { DbService } from '@app/db';
import { EventPublisherService } from '@app/events';
import {
  SubscriptionNotFoundException,
  ActiveSubscriptionExistsException,
  PlanNotFoundException,
  SubscriptionPausedException,
  InvalidPlanChangeException,
} from '../shared/exceptions/subscription.exceptions';
import * as schema from '../shared/schemas/entities/schema';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let dbService: jest.Mocked<DbService<typeof schema>>;
  let eventPublisher: jest.Mocked<EventPublisherService>;

  const mockUser = {
    id: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTier = {
    id: 'tier-123',
    code: 'PREMIUM',
    name: 'Premium',
    priorityLevel: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPlan = {
    id: 'plan-123',
    tierId: 'tier-123',
    price: 10000,
    durationDays: 30,
    currency: 'KRW',
    isActive: true,
    trialDays: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSubscription = {
    id: 'sub-123',
    userId: 'user-123',
    planId: 'plan-123',
    status: 'ACTIVE' as const,
    startedAt: '2024-01-01',
    nextBillingDate: '2024-02-01',
    previousSubscriptionId: null,
    changeType: 'INITIAL' as const,
    adjustmentAmount: 0,
    isVoided: false,
    voidedAt: null,
    voidReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRight = {
    id: 'right-123',
    userId: 'user-123',
    tierId: 'tier-123',
    subscriptionId: 'sub-123',
    startsAt: '2024-01-01',
    endsAt: '2024-01-31',
    isActive: true,
    pausedAt: null,
    closedAt: null,
    createdByEventId: null,
    closedByEventId: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockDbService = {
      db: {
        select: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
        transaction: jest.fn(),
      },
    };

    const mockEventPublisher = {
      publishEvent: jest.fn(),
      setServiceName: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: EventPublisherService,
          useValue: mockEventPublisher,
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    dbService = module.get(DbService);
    eventPublisher = module.get(EventPublisherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCurrentSubscription', () => {
    it('should return current subscription when user has active subscription', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            subscription: mockSubscription,
            plan: mockPlan,
            tier: mockTier,
            activeRight: mockRight,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getCurrentSubscription('user-123');

      // Assert
      expect(result).toEqual({
        id: 'sub-123',
        status: 'ACTIVE',
        currentTier: {
          id: 'tier-123',
          code: 'PREMIUM',
          name: 'Premium',
          priorityLevel: 3,
        },
        plan: {
          id: 'plan-123',
          price: 10000,
          durationDays: 30,
          currency: 'KRW',
        },
        nextBillingDate: '2024-02-01',
        startsAt: '2024-01-01',
        endsAt: '2024-01-31',
        isPaused: false,
        pausedAt: null,
      });
    });

    it('should return null when user has no active subscription', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getCurrentSubscription('user-123');

      // Assert
      expect(result).toBeNull();
    });

    it('should return PAUSED status when subscription is paused', async () => {
      // Arrange
      const pausedRight = {
        ...mockRight,
        pausedAt: new Date(),
      };

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            subscription: mockSubscription,
            plan: mockPlan,
            tier: mockTier,
            activeRight: pausedRight,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getCurrentSubscription('user-123');

      // Assert
      expect(result?.status).toBe('PAUSED');
      expect(result?.isPaused).toBe(true);
      expect(result?.pausedAt).toBeDefined();
    });
  });

  describe('createSubscription', () => {
    it('should create new subscription successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockPlan]),
              }),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Mock getCurrentSubscription to return null (no existing subscription)
      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(null);

      // Act
      const result = await service.createSubscription('user-123', 'plan-123');

      // Assert
      expect(result).toHaveProperty('subscriptionId');
      expect(result).toHaveProperty('rightId');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw ActiveSubscriptionExistsException when user already has active subscription', async () => {
      // Arrange
      const existingSubscription = {
        id: 'existing-sub',
        status: 'ACTIVE' as const,
        currentTier: {
          id: mockTier.id,
          code: mockTier.code,
          name: mockTier.name,
          priorityLevel: mockTier.priorityLevel,
        },
        plan: {
          id: mockPlan.id,
          price: mockPlan.price,
          durationDays: mockPlan.durationDays,
          currency: mockPlan.currency,
        },
        nextBillingDate: '2024-02-01',
        startsAt: '2024-01-01',
        endsAt: '2024-01-31',
        isPaused: false,
        pausedAt: null,
      };

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {};
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;
      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(existingSubscription);

      // Act & Assert
      await expect(
        service.createSubscription('user-123', 'plan-123')
      ).rejects.toThrow(ActiveSubscriptionExistsException);
    });

    it('should throw PlanNotFoundException when plan does not exist', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // Empty array = plan not found
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;
      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createSubscription('user-123', 'invalid-plan')
      ).rejects.toThrow(PlanNotFoundException);
    });
  });

  describe('upgradeSubscription', () => {
    it('should upgrade subscription successfully', async () => {
      // Arrange
      const currentSub = {
        id: 'sub-123',
        status: 'ACTIVE' as const,
        currentTier: {
          id: mockTier.id,
          code: mockTier.code,
          name: mockTier.name,
          priorityLevel: 2, // Lower priority
        },
        plan: {
          id: mockPlan.id,
          price: mockPlan.price,
          durationDays: mockPlan.durationDays,
          currency: mockPlan.currency,
        },
        nextBillingDate: '2024-02-01',
        startsAt: '2024-01-01',
        endsAt: '2024-01-31',
        isPaused: false,
        pausedAt: null,
      };

      const newTier = { ...mockTier, priorityLevel: 3 }; // Higher priority
      const newPlan = { ...mockPlan, id: 'new-plan-123', price: 15000 };

      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(currentSub);

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([
                    { plan: newPlan, tier: newTier },
                  ]),
                }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(undefined),
            }),
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act
      const result = await service.upgradeSubscription('user-123', 'new-plan-123');

      // Assert
      expect(result).toHaveProperty('newSubscriptionId');
      expect(result).toHaveProperty('adjustmentAmount');
      expect(result).toHaveProperty('effectiveDate');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw SubscriptionNotFoundException when user has no active subscription', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {};
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;
      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.upgradeSubscription('user-123', 'new-plan-123')
      ).rejects.toThrow(SubscriptionNotFoundException);
    });

    it('should throw SubscriptionPausedException when subscription is paused', async () => {
      // Arrange
      const pausedSub = {
        id: 'sub-123',
        status: 'ACTIVE' as const,
        currentTier: {
          id: mockTier.id,
          code: mockTier.code,
          name: mockTier.name,
          priorityLevel: mockTier.priorityLevel,
        },
        plan: {
          id: mockPlan.id,
          price: mockPlan.price,
          durationDays: mockPlan.durationDays,
          currency: mockPlan.currency,
        },
        nextBillingDate: '2024-02-01',
        startsAt: '2024-01-01',
        endsAt: '2024-01-31',
        isPaused: true,
        pausedAt: new Date('2024-01-15'),
      };

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {};
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;
      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(pausedSub);

      // Act & Assert
      await expect(
        service.upgradeSubscription('user-123', 'new-plan-123')
      ).rejects.toThrow(SubscriptionPausedException);
    });

    it('should throw InvalidPlanChangeException when trying to downgrade', async () => {
      // Arrange
      const currentSub = {
        id: 'sub-123',
        status: 'ACTIVE' as const,
        currentTier: {
          id: mockTier.id,
          code: mockTier.code,
          name: mockTier.name,
          priorityLevel: 3, // Higher priority
        },
        plan: {
          id: mockPlan.id,
          price: mockPlan.price,
          durationDays: mockPlan.durationDays,
          currency: mockPlan.currency,
        },
        nextBillingDate: '2024-02-01',
        startsAt: '2024-01-01',
        endsAt: '2024-01-31',
        isPaused: false,
        pausedAt: null,
      };

      const lowerTier = { ...mockTier, priorityLevel: 2 }; // Lower priority
      const newPlan = { ...mockPlan, id: 'new-plan-123' };

      jest.spyOn(service, 'getCurrentSubscription').mockResolvedValue(currentSub);

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([
                    { plan: newPlan, tier: lowerTier },
                  ]),
                }),
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.upgradeSubscription('user-123', 'new-plan-123')
      ).rejects.toThrow(InvalidPlanChangeException);
    });
  });

  describe('getSubscriptionHistory', () => {
    it('should return subscription history', async () => {
      // Arrange
      const mockHistory = [
        {
          subscription: mockSubscription,
          plan: mockPlan,
          tier: mockTier,
        },
      ];

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockHistory),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getSubscriptionHistory('user-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'sub-123',
        planId: 'plan-123',
        tierCode: 'PREMIUM',
        tierName: 'Premium',
        status: 'ACTIVE',
        startedAt: '2024-01-01',
        endedAt: null,
        changeType: 'INITIAL',
        adjustmentAmount: 0,
        price: 10000,
        currency: 'KRW',
        durationDays: 30,
        createdAt: mockSubscription.createdAt.toISOString(),
      });
    });

    it('should return empty array when user has no subscription history', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getSubscriptionHistory('user-123');

      // Assert
      expect(result).toEqual([]);
    });
  });
});