import { Test, TestingModule } from '@nestjs/testing';
import { PauseService } from './pause.service';
import { DbService } from '@app/db';
import { EventPublisherService } from '@app/events';
import {
  SubscriptionNotFoundException,
  SubscriptionPausedException,
  PauseQuotaExceededException,
} from '../shared/exceptions/subscription.exceptions';
import * as schema from '../shared/schemas/entities/schema';

describe('PauseService', () => {
  let service: PauseService;
  let dbService: jest.Mocked<DbService<typeof schema>>;
  // Note: EventPublisherService is commented out in the actual service for future implementation

  const mockActiveSubscription = {
    subscription: {
      id: 'sub-123',
      userId: 'user-123',
      planId: 'plan-123',
      status: 'ACTIVE' as const,
    },
    plan: {
      id: 'plan-123',
      price: 10000,
      durationDays: 30,
    },
    tier: {
      id: 'tier-123',
      code: 'PREMIUM',
      name: 'Premium',
    },
    activeRight: {
      id: 'right-123',
      userId: 'user-123',
      subscriptionId: 'sub-123',
      startsAt: '2024-01-01',
      endsAt: '2024-01-31',
      isActive: true,
      pausedAt: null,
    },
  };

  const mockPauseRequest = {
    startDate: '2024-01-15T00:00:00.000Z',
    endDate: '2024-01-22T00:00:00.000Z',
    reason: '휴가',
  };

  beforeEach(async () => {
    const mockDbService = {
      db: {
        transaction: jest.fn(),
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([]),
              limit: jest.fn().mockResolvedValue([]),
            }),
            innerJoin: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([]),
                  }),
                }),
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

    const mockEventPublisher = {
      publishEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PauseService,
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

    service = module.get<PauseService>(PauseService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('pauseSubscription', () => {
    it('should pause subscription successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        // Create a comprehensive mock transaction object
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  innerJoin: jest.fn().mockReturnValue({
                    leftJoin: jest.fn().mockReturnValue({
                      where: jest.fn().mockReturnValue({
                        limit: jest
                          .fn()
                          .mockResolvedValue([mockActiveSubscription]),
                      }),
                    }),
                  }),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest
                    .fn()
                    .mockResolvedValue([{ pauseCount: 0, totalPausedDays: 0 }]),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest
                  .fn()
                  .mockResolvedValue([{ ruleValue: { limit: 2 } }]),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue([]),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([]),
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

      // Mock the database select for policies
      dbService.db.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ ruleValue: { minDays: 7 } }]),
        }),
      });

      // Act
      const result = await service.pauseSubscription(
        'user-123',
        mockPauseRequest,
      );

      // Assert
      expect(result).toHaveProperty('pauseId');
      expect(result.startDate).toBe(mockPauseRequest.startDate);
      expect(result.endDate).toBe(mockPauseRequest.endDate);
      expect(result).toHaveProperty('eventPayload');
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw SubscriptionNotFoundException when no active subscription', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  leftJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([]), // No active subscription
                    }),
                  }),
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
        service.pauseSubscription('user-123', mockPauseRequest),
      ).rejects.toThrow(SubscriptionNotFoundException);
    });

    it('should throw SubscriptionPausedException when already paused', async () => {
      // Arrange
      const pausedSubscription = {
        ...mockActiveSubscription,
        activeRight: {
          ...mockActiveSubscription.activeRight,
          pausedAt: new Date(),
        },
      };

      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  leftJoin: jest.fn().mockReturnValue({
                    where: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue([pausedSubscription]),
                    }),
                  }),
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
        service.pauseSubscription('user-123', mockPauseRequest),
      ).rejects.toThrow(SubscriptionPausedException);
    });

    it('should throw PauseQuotaExceededException when quota exceeded', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  innerJoin: jest.fn().mockReturnValue({
                    leftJoin: jest.fn().mockReturnValue({
                      where: jest.fn().mockReturnValue({
                        limit: jest
                          .fn()
                          .mockResolvedValue([mockActiveSubscription]),
                      }),
                    }),
                  }),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ pauseCount: 2 }]), // Already used quota
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue([{ ruleValue: { limit: 2 } }]),
              }),
            }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(
        service.pauseSubscription('user-123', mockPauseRequest),
      ).rejects.toThrow(PauseQuotaExceededException);
    });
  });

  describe('resumeSubscription', () => {
    const mockActivePause = {
      id: 'pause-123',
      userId: 'user-123',
      subscriptionId: 'sub-123',
      startsAt: '2024-01-15',
      endsAt: '2024-01-22',
      status: 'ACTIVE' as const,
    };

    it('should resume subscription successfully', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest
            .fn()
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([mockActivePause]),
                }),
              }),
            })
            .mockReturnValueOnce({
              from: jest.fn().mockReturnValue({
                innerJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue([
                    {
                      pauseAffected: {
                        pauseId: 'pause-123',
                        rightId: 'right-123',
                        originalEndsAt: '2024-01-31',
                        adjustedEndsAt: '2024-02-07',
                      },
                      right: {
                        id: 'right-123',
                        endsAt: '2024-01-31',
                      },
                    },
                  ]),
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
      const result = await service.resumeSubscription('user-123', {
        reason: '휴가 종료',
      });

      // Assert
      expect(result).toHaveProperty('resumedAt');
      expect(result).toHaveProperty('extensionDays');
      expect(result).toHaveProperty('newEndDate');
      expect(result.extensionDays).toBe(7); // 7 days extension
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should throw error when no active pause', async () => {
      // Arrange
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]), // No active pause
              }),
            }),
          }),
        };
        return callback(mockTx);
      });

      dbService.db.transaction = mockTransaction;

      // Act & Assert
      await expect(service.resumeSubscription('user-123')).rejects.toThrow(
        SubscriptionNotFoundException,
      );
    });
  });

  describe('getPauseHistory', () => {
    it('should return pause history', async () => {
      // Arrange
      const mockHistory = [
        {
          id: 'pause-123',
          startsAt: '2024-01-15',
          endsAt: '2024-01-22',
          actualResumedAt: '2024-01-20',
          status: 'ENDED' as const,
          createdAt: new Date('2024-01-15'),
        },
      ];

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockHistory),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPauseHistory('user-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'pause-123',
        startsAt: '2024-01-15',
        endsAt: '2024-01-22',
        actualResumedAt: '2024-01-20',
        status: 'ENDED',
        createdAt: '2024-01-15T00:00:00.000Z',
      });
    });

    it('should return empty array when no history', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getPauseHistory('user-123');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('checkPauseEligibility', () => {
    it('should return eligibility information', async () => {
      // Arrange
      const mockTx = {
        select: jest
          .fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ pauseCount: 1 }]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue([{ ruleValue: { limit: 2 } }]),
            }),
          }),
      };

      // Act
      const result = await service.checkPauseEligibility(
        mockTx,
        'user-123',
        2024,
      );

      // Assert
      expect(result).toEqual({
        eligible: true,
        currentUsage: 1,
        maxPauses: 2,
        remainingPauses: 1,
      });
    });

    it('should return ineligible when quota exceeded', async () => {
      // Arrange
      const mockTx = {
        select: jest
          .fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ pauseCount: 2 }]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue([{ ruleValue: { limit: 2 } }]),
            }),
          }),
      };

      // Act
      const result = await service.checkPauseEligibility(
        mockTx,
        'user-123',
        2024,
      );

      // Assert
      expect(result).toEqual({
        eligible: false,
        currentUsage: 2,
        maxPauses: 2,
        remainingPauses: 0,
      });
    });
  });
});
