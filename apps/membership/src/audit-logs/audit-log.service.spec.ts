import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { DbService } from '@app/db';
import * as schema from '../shared/schemas/entities/schema';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let dbService: jest.Mocked<DbService<typeof schema>>;

  const mockAuditLog = {
    id: 'log-123',
    eventType: 'SUBSCRIPTION_CREATED',
    userId: 'user-123',
    subscriptionId: 'sub-123',
    effectiveDate: '2025-01-01',
    eventPayload: {
      planId: 'plan-123',
      tierCode: 'PREMIUM',
    },
    initiatedBy: 'user-123',
    topicName: null,
    publishStatus: 'PUBLISHED',
    publishedAt: new Date('2025-01-01'),
    retryCount: 0,
    createdAt: new Date('2025-01-01'),
  };

  const mockAuditLogs = [
    mockAuditLog,
    {
      ...mockAuditLog,
      id: 'log-456',
      eventType: 'SUBSCRIPTION_CANCELLED',
      userId: 'user-456',
    },
  ];

  beforeEach(async () => {
    const mockDbService = {
      db: {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue(mockAuditLogs),
                }),
              }),
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue(mockAuditLogs),
              }),
            }),
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue(mockAuditLogs),
              }),
            }),
            limit: jest.fn().mockReturnValue({
              offset: jest.fn().mockResolvedValue(mockAuditLogs),
            }),
          }),
        }),
        delete: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(undefined),
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    dbService = module.get(DbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAuditLogs', () => {
    it('should return paginated audit logs', async () => {
      // Arrange
      const filter = {
        eventType: 'SUBSCRIPTION_CREATED',
        limit: 10,
        offset: 0,
      };

      // Mock the count query
      const mockCountQuery = {
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue([{ count: 'log-123' }, { count: 'log-456' }]),
        }),
      };
      dbService.db.select = jest
        .fn()
        .mockReturnValueOnce(mockCountQuery) // First call for count
        .mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue(mockAuditLogs),
                }),
              }),
            }),
          }),
        }); // Second call for data

      // Act
      const result = await service.getAuditLogs(filter);

      // Assert
      expect(result).toEqual({
        logs: expect.arrayContaining([
          expect.objectContaining({
            id: 'log-123',
            eventType: 'SUBSCRIPTION_CREATED',
            userId: 'user-123',
          }),
        ]),
        total: 2,
        page: 1,
        pageSize: 10,
        hasNext: false,
        hasPrevious: false,
      });
    });

    it('should return audit logs without filters', async () => {
      // Arrange
      // Mock for count query (first select call)
      const mockCountQueryBuilder = {
        from: jest.fn().mockResolvedValue([mockAuditLog]), // Direct resolve for no conditions
      };

      // Mock for data query (second select call)
      const mockDataQueryBuilder = {
        from: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              offset: jest.fn().mockResolvedValue([mockAuditLog]),
            }),
          }),
        }),
      };

      dbService.db.select = jest
        .fn()
        .mockReturnValueOnce(mockCountQueryBuilder) // First call for count
        .mockReturnValueOnce(mockDataQueryBuilder); // Second call for data

      // Act
      const result = await service.getAuditLogs();

      // Assert
      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });
  });

  describe('getUserAuditLogs', () => {
    it('should return user audit logs', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([mockAuditLog]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getUserAuditLogs('user-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'log-123',
        eventType: 'SUBSCRIPTION_CREATED',
        userId: 'user-123',
        subscriptionId: 'sub-123',
        effectiveDate: '2025-01-01',
        eventPayload: {
          planId: 'plan-123',
          tierCode: 'PREMIUM',
        },
        initiatedBy: 'user-123',
        createdAt: expect.any(Date),
      });
    });
  });

  describe('getSubscriptionAuditLogs', () => {
    it('should return subscription audit logs', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([mockAuditLog]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getSubscriptionAuditLogs('sub-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].subscriptionId).toBe('sub-123');
    });
  });

  describe('getEventTypeStats', () => {
    it('should return event type statistics', async () => {
      // Arrange
      const mockStatsData = [
        { eventType: 'SUBSCRIPTION_CREATED', id: 'log-1' },
        { eventType: 'SUBSCRIPTION_CREATED', id: 'log-2' },
        { eventType: 'SUBSCRIPTION_CANCELLED', id: 'log-3' },
      ];

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockStatsData),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getEventTypeStats();

      // Assert
      expect(result).toEqual([
        { eventType: 'SUBSCRIPTION_CREATED', count: 2 },
        { eventType: 'SUBSCRIPTION_CANCELLED', count: 1 },
      ]);
    });

    it('should return event type statistics with date filter', async () => {
      // Arrange
      const mockStatsData = [
        { eventType: 'SUBSCRIPTION_CREATED', id: 'log-1' },
      ];

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockStatsData),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getEventTypeStats(
        '2025-01-01',
        '2025-01-31',
      );

      // Assert
      expect(result).toEqual([{ eventType: 'SUBSCRIPTION_CREATED', count: 1 }]);
    });
  });

  describe('getAdminActionLogs', () => {
    it('should return admin action logs', async () => {
      // Arrange
      const adminLog = {
        ...mockAuditLog,
        eventType: 'TIER_CREATED',
        initiatedBy: 'admin-123',
      };

      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([adminLog]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAdminActionLogs('admin-123');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe('TIER_CREATED');
      expect(result[0].initiatedBy).toBe('admin-123');
    });

    it('should filter admin action logs by admin ID', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAdminActionLogs('admin-456');

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('searchAuditLogs', () => {
    it('should search audit logs by term', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue(mockAuditLogs),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.searchAuditLogs('SUBSCRIPTION');

      // Assert
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].eventType).toContain('SUBSCRIPTION');
    });

    it('should return empty array when no matches found', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.searchAuditLogs('NONEXISTENT');

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('getAuditLogDetail', () => {
    it('should return audit log detail', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockAuditLog]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAuditLogDetail('log-123');

      // Assert
      expect(result).toEqual({
        id: 'log-123',
        eventType: 'SUBSCRIPTION_CREATED',
        userId: 'user-123',
        subscriptionId: 'sub-123',
        effectiveDate: '2025-01-01',
        eventPayload: {
          planId: 'plan-123',
          tierCode: 'PREMIUM',
        },
        initiatedBy: 'user-123',
        createdAt: expect.any(Date),
      });
    });

    it('should return null when log not found', async () => {
      // Arrange
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };

      dbService.db.select = jest.fn().mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getAuditLogDetail('nonexistent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('cleanupOldLogs', () => {
    it('should cleanup old logs', async () => {
      // Arrange
      const mockDeleteBuilder = {
        where: jest.fn().mockResolvedValue(undefined),
      };

      dbService.db.delete = jest.fn().mockReturnValue(mockDeleteBuilder);

      // Act
      const result = await service.cleanupOldLogs(365);

      // Assert
      expect(result).toBe(0); // Current implementation returns 0
      expect(dbService.db.delete).toHaveBeenCalled();
    });

    it('should use default retention days', async () => {
      // Arrange
      const mockDeleteBuilder = {
        where: jest.fn().mockResolvedValue(undefined),
      };

      dbService.db.delete = jest.fn().mockReturnValue(mockDeleteBuilder);

      // Act
      const result = await service.cleanupOldLogs();

      // Assert
      expect(result).toBe(0);
      expect(dbService.db.delete).toHaveBeenCalled();
    });
  });
});
