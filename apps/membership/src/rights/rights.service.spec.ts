import { Test, TestingModule } from '@nestjs/testing';
import { RightsService } from './rights.service';
import { DbService } from '@app/db';

import { RightsNotFoundException } from '../shared/exceptions/subscription.exceptions';
import * as schema from '../shared/schemas/entities/schema';

describe('RightsService', () => {
  let service: RightsService;
  let dbService: jest.Mocked<DbService<typeof schema>>;

  const mockSubscriptionRight = {
    id: 'right-123',
    userId: 'user-123',
    tierId: 'tier-123',
    subscriptionId: 'sub-123',
    startsAt: '2025-01-01',
    endsAt: '2025-12-31', // Future date to ensure it's not expired
    isActive: true,
    pausedAt: null,
    closedAt: null,
    createdByEventId: null,
    closedByEventId: null,
    createdAt: new Date('2025-01-01'),
  };

  const mockTier = {
    id: 'tier-123',
    code: 'PREMIUM',
    name: 'Premium',
    priorityLevel: 3,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    const mockDbService = {
      db: {
        transaction: jest.fn(),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
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
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RightsService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<RightsService>(RightsService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUserRights', () => {
    it('should create user rights successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockSubscriptionRight]),
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
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      const startsAt = new Date('2024-01-01');
      const endsAt = new Date('2024-01-31');

      // Act
      const result = await service.createUserRights(
        'user-123',
        'sub-123',
        'tier-123',
        startsAt,
        endsAt,
        'event-123',
      );

      // Assert
      expect(result).toEqual(mockSubscriptionRight);
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('terminateUserRights', () => {
    it('should terminate user rights successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockSubscriptionRight]),
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
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act
      await service.terminateUserRights(
        'user-123',
        'User requested cancellation',
      );

      // Assert
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw RightsNotFoundException when no active rights', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]), // No active rights
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.terminateUserRights('user-123', 'User requested cancellation'),
      ).rejects.toThrow(RightsNotFoundException);
    });
  });

  describe('pauseUserRights', () => {
    it('should pause user rights successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockSubscriptionRight]),
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
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      const pausedAt = new Date('2024-01-15');

      // Act
      await service.pauseUserRights('user-123', pausedAt);

      // Assert
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw RightsNotFoundException when no active rights', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]), // No active rights
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      const pausedAt = new Date('2024-01-15');

      // Act & Assert
      await expect(
        service.pauseUserRights('user-123', pausedAt),
      ).rejects.toThrow(RightsNotFoundException);
    });
  });

  describe('resumeUserRights', () => {
    it('should resume user rights successfully', async () => {
      // Arrange
      const pausedRight = {
        ...mockSubscriptionRight,
        pausedAt: new Date('2024-01-15'),
      };

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([pausedRight]),
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
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      const newEndsAt = new Date('2024-02-07');

      // Act
      await service.resumeUserRights('user-123', newEndsAt);

      // Assert
      expect(mockTransaction).toHaveBeenCalled();
    });
  });

  describe('getUserRights', () => {
    it('should return user rights', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([
          {
            right: mockSubscriptionRight,
            tier: mockTier,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getUserRights('user-123');

      // Assert
      expect(result).toEqual({
        userId: 'user-123',
        tierId: 'tier-123',
        startsAt: '2025-01-01',
        endsAt: '2025-12-31',
        isActive: true,
        pausedAt: null,
        tierCode: 'PREMIUM',
        isPaused: false,
      });
    });

    it('should return null when no active rights', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]), // No results
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getUserRights('user-123');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('bulkCheckSubscriptions', () => {
    it('should return bulk subscription check results', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            right: mockSubscriptionRight,
            tier: mockTier,
          },
        ]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.bulkCheckSubscriptions([
        'user-123',
        'user-456',
      ]);

      // Assert
      expect(result).toEqual({
        'user-123': {
          hasActiveSubscription: true,
          tierCode: 'PREMIUM',
          isPaused: false,
          expiresAt: '2025-12-31',
        },
        'user-456': {
          hasActiveSubscription: false,
        },
      });
    });
  });

  describe('validateUserRights', () => {
    it('should return true for valid rights', async () => {
      // Arrange
      jest.spyOn(service, 'getUserRights').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        startsAt: '2025-01-01',
        endsAt: '2025-12-31', // Future date
        isActive: true,
        pausedAt: null,
        tierCode: 'PREMIUM',
        isPaused: false,
      });

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockTier]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.validateUserRights('user-123', 2);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for paused rights', async () => {
      // Arrange
      jest.spyOn(service, 'getUserRights').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        startsAt: '2024-01-01',
        endsAt: '2024-12-31',
        isActive: true,
        pausedAt: new Date('2024-01-15'),
        tierCode: 'PREMIUM',
        isPaused: true,
      });

      // Act
      const result = await service.validateUserRights('user-123');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for expired rights', async () => {
      // Arrange
      jest.spyOn(service, 'getUserRights').mockResolvedValue({
        userId: 'user-123',
        tierId: 'tier-123',
        startsAt: '2024-01-01',
        endsAt: '2023-12-31', // Past date
        isActive: true,
        pausedAt: null,
        tierCode: 'PREMIUM',
        isPaused: false,
      });

      // Act
      const result = await service.validateUserRights('user-123');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no rights exist', async () => {
      // Arrange
      jest.spyOn(service, 'getUserRights').mockResolvedValue(null);

      // Act
      const result = await service.validateUserRights('user-123');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('extendUserRights', () => {
    it('should extend user rights successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockSubscriptionRight]),
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
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act
      await service.extendUserRights('user-123', 30, 'Bonus extension');

      // Assert
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw RightsNotFoundException when no active rights', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]), // No active rights
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.extendUserRights('user-123', 30, 'Bonus extension'),
      ).rejects.toThrow(RightsNotFoundException);
    });
  });
});
