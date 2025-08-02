import { Test, TestingModule } from '@nestjs/testing';
import { PlanService } from './plan.service';
import { DbService } from '@app/db';
import { PlanNotFoundException } from '../shared/exceptions/subscription.exceptions';
import * as schema from '../shared/schemas/entities/schema';

describe('PlanService', () => {
  let service: PlanService;
  let dbService: jest.Mocked<DbService<typeof schema>>;

  const mockTier = {
    id: 'tier-123',
    code: 'PREMIUM',
    name: 'Premium',
    priorityLevel: 3,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPlan = {
    id: 'plan-123',
    tierId: 'tier-123',
    price: 10000,
    durationDays: 30,
    currency: 'KRW',
    isActive: true,
    trialDays: 7,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const mockDbService = {
      db: {
        select: jest.fn(),
        transaction: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<PlanService>(PlanService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllPlans', () => {
    it('should return all active plans with tier information', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([
          {
            plan: mockPlan,
            tier: mockTier,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAllPlans();

      // Assert
      expect(result).toEqual([
        {
          id: 'plan-123',
          tierId: 'tier-123',
          tierCode: 'PREMIUM',
          tierName: 'Premium',
          priorityLevel: 3,
          price: 10000,
          durationDays: 30,
          currency: 'KRW',
          trialDays: 7,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('should return empty array when no active plans exist', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAllPlans();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getPlanDetails', () => {
    it('should return plan details with tier information', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            plan: mockPlan,
            tier: mockTier,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPlanDetails('plan-123');

      // Assert
      expect(result).toEqual({
        id: 'plan-123',
        tier: {
          id: 'tier-123',
          code: 'PREMIUM',
          name: 'Premium',
          priorityLevel: 3,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        price: 10000,
        durationDays: 30,
        currency: 'KRW',
        trialDays: 7,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should throw PlanNotFoundException when plan does not exist', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act & Assert
      await expect(service.getPlanDetails('invalid-plan')).rejects.toThrow(
        PlanNotFoundException,
      );
    });
  });

  describe('getAllTiers', () => {
    it('should return all tiers ordered by priority level', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([mockTier]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAllTiers();

      // Assert
      expect(result).toEqual([
        {
          id: 'tier-123',
          code: 'PREMIUM',
          name: 'Premium',
          priorityLevel: 3,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('getPlansByTier', () => {
    it('should return all active plans for a specific tier', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([mockPlan]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPlansByTier('tier-123');

      // Assert
      expect(result).toEqual([
        {
          id: 'plan-123',
          price: 10000,
          durationDays: 30,
          currency: 'KRW',
          trialDays: 7,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('should return empty array when tier has no active plans', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPlansByTier('tier-123');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getTierBenefits', () => {
    it('should return tier benefits with plans', async () => {
      // Arrange
      const mockTierQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockTier]),
      };

      const mockPlansQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([mockPlan]),
      };

      dbService.db.select = jest
        .fn()
        .mockReturnValueOnce(mockTierQueryBuilder)
        .mockReturnValueOnce(mockPlansQueryBuilder);

      // Act
      const result = await service.getTierBenefits('tier-123');

      // Assert
      expect(result).toEqual({
        tier: {
          id: 'tier-123',
          code: 'PREMIUM',
          name: 'Premium',
          priorityLevel: 3,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        plans: [
          {
            id: 'plan-123',
            price: 10000,
            durationDays: 30,
            currency: 'KRW',
            trialDays: 7,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        benefits: [
          {
            type: 'storage',
            description: 'Premium 티어 스토리지 혜택',
            value: '30GB',
          },
          {
            type: 'support',
            description: 'Premium 티어 지원 혜택',
            value: '24/7 지원',
          },
        ],
      });
    });

    it('should throw PlanNotFoundException when tier does not exist', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act & Assert
      await expect(service.getTierBenefits('invalid-tier')).rejects.toThrow(
        PlanNotFoundException,
      );
    });
  });

  // ===== 관리자용 메서드 테스트 =====

  describe('createTier', () => {
    const createTierInput = {
      code: 'ENTERPRISE',
      name: 'Enterprise',
      priorityLevel: 5,
    };

    it('should create tier successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No existing code
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No existing priority
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

      // Act
      const result = await service.createTier(createTierInput, 'admin-123');

      // Assert
      expect(result).toHaveProperty('tierId');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw error when tier code already exists', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockTier]), // Existing code
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.createTier(createTierInput, 'admin-123'),
      ).rejects.toThrow("티어 코드 'ENTERPRISE'가 이미 존재합니다");
    });

    it('should throw error when priority level already exists', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No existing code
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([mockTier]), // Existing priority
                }),
              }),
            }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.createTier(createTierInput, 'admin-123'),
      ).rejects.toThrow('우선순위 5이 이미 존재합니다');
    });
  });

  describe('updateTier', () => {
    const updateTierInput = {
      name: 'Updated Premium',
      priorityLevel: 4,
    };

    it('should update tier successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([mockTier]), // Existing tier
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No priority conflict
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
      const result = await service.updateTier(
        'tier-123',
        updateTierInput,
        'admin-123',
      );

      // Assert
      expect(result).toEqual({ tierId: 'tier-123' });
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw PlanNotFoundException when tier does not exist', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // No existing tier
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.updateTier('invalid-tier', updateTierInput, 'admin-123'),
      ).rejects.toThrow(PlanNotFoundException);
    });
  });

  describe('createPlan', () => {
    const createPlanInput = {
      tierId: 'tier-123',
      price: 15000,
      durationDays: 60,
      currency: 'KRW',
      trialDays: 14,
    };

    it('should create plan successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockTier]), // Existing tier
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

      // Act
      const result = await service.createPlan(createPlanInput, 'admin-123');

      // Assert
      expect(result).toHaveProperty('planId');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw PlanNotFoundException when tier does not exist', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // No existing tier
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.createPlan(createPlanInput, 'admin-123'),
      ).rejects.toThrow(PlanNotFoundException);
    });
  });

  describe('updatePlan', () => {
    const updatePlanInput = {
      price: 12000,
      durationDays: 45,
    };

    it('should update plan successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest
                      .fn()
                      .mockResolvedValue([{ plan: mockPlan, tier: mockTier }]),
                  }),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([]), // No active subscribers
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
      const result = await service.updatePlan(
        'plan-123',
        updatePlanInput,
        'admin-123',
      );

      // Assert
      expect(result).toEqual({ planId: 'plan-123' });
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw PlanNotFoundException when plan does not exist', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No existing plan
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
        service.updatePlan('invalid-plan', updatePlanInput, 'admin-123'),
      ).rejects.toThrow(PlanNotFoundException);
    });
  });

  describe('deactivatePlan', () => {
    it('should deactivate plan successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([{ plan: mockPlan, tier: mockTier }]),
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
      const result = await service.deactivatePlan(
        'plan-123',
        '더 이상 제공하지 않음',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({ planId: 'plan-123' });
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw PlanNotFoundException when plan does not exist', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]), // No existing plan
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
        service.deactivatePlan(
          'invalid-plan',
          '더 이상 제공하지 않음',
          'admin-123',
        ),
      ).rejects.toThrow(PlanNotFoundException);
    });
  });
});
