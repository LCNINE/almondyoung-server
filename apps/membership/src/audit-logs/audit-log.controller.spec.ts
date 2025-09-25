import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let service: jest.Mocked<AuditLogService>;

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
    createdAt: new Date('2025-01-01'),
  };

  const mockAuditLogResponse = {
    logs: [mockAuditLog],
    total: 1,
    page: 1,
    pageSize: 50,
    hasNext: false,
    hasPrevious: false,
  };

  const mockEventTypeStats = [
    { eventType: 'SUBSCRIPTION_CREATED', count: 5 },
    { eventType: 'SUBSCRIPTION_CANCELLED', count: 2 },
  ];

  beforeEach(async () => {
    const mockService = {
      getAuditLogs: jest.fn(),
      getUserAuditLogs: jest.fn(),
      getSubscriptionAuditLogs: jest.fn(),
      getEventTypeStats: jest.fn(),
      getAdminActionLogs: jest.fn(),
      searchAuditLogs: jest.fn(),
      getAuditLogDetail: jest.fn(),
      cleanupOldLogs: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    service = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAuditLogs', () => {
    it('should return paginated audit logs', async () => {
      // Arrange
      service.getAuditLogs.mockResolvedValue(mockAuditLogResponse);

      // Act
      const result = await controller.getAuditLogs(
        'SUBSCRIPTION_CREATED',
        'user-123',
        undefined,
        undefined,
        undefined,
        undefined,
        '10',
        '0',
        'createdAt',
        'desc',
        'admin-123',
      );

      // Assert
      expect(result).toEqual(mockAuditLogResponse);
      expect(service.getAuditLogs).toHaveBeenCalledWith({
        eventType: 'SUBSCRIPTION_CREATED',
        userId: 'user-123',
        subscriptionId: undefined,
        initiatedBy: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });

    it('should handle default parameters', async () => {
      // Arrange
      service.getAuditLogs.mockResolvedValue(mockAuditLogResponse);

      // Act
      const result = await controller.getAuditLogs();

      // Assert
      expect(result).toEqual(mockAuditLogResponse);
      expect(service.getAuditLogs).toHaveBeenCalledWith({
        eventType: undefined,
        userId: undefined,
        subscriptionId: undefined,
        initiatedBy: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        sortOrder: undefined,
      });
    });
  });

  describe('getUserAuditLogs', () => {
    it('should return user audit logs', async () => {
      // Arrange
      service.getUserAuditLogs.mockResolvedValue([mockAuditLog]);

      // Act
      const result = await controller.getUserAuditLogs(
        'user-123',
        '10',
        '0',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        logs: [mockAuditLog],
        userId: 'user-123',
        limit: 10,
        offset: 0,
        retrievedAt: expect.any(String),
      });
      expect(service.getUserAuditLogs).toHaveBeenCalledWith('user-123', 10, 0);
    });

    it('should use default limit and offset', async () => {
      // Arrange
      service.getUserAuditLogs.mockResolvedValue([mockAuditLog]);

      // Act
      const result = await controller.getUserAuditLogs('user-123');

      // Assert
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(service.getUserAuditLogs).toHaveBeenCalledWith('user-123', 20, 0);
    });
  });

  describe('getSubscriptionAuditLogs', () => {
    it('should return subscription audit logs', async () => {
      // Arrange
      service.getSubscriptionAuditLogs.mockResolvedValue([mockAuditLog]);

      // Act
      const result = await controller.getSubscriptionAuditLogs(
        'sub-123',
        '15',
        '5',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        logs: [mockAuditLog],
        subscriptionId: 'sub-123',
        limit: 15,
        offset: 5,
        retrievedAt: expect.any(String),
      });
      expect(service.getSubscriptionAuditLogs).toHaveBeenCalledWith(
        'sub-123',
        15,
        5,
      );
    });
  });

  describe('getEventTypeStats', () => {
    it('should return event type statistics', async () => {
      // Arrange
      service.getEventTypeStats.mockResolvedValue(mockEventTypeStats);

      // Act
      const result = await controller.getEventTypeStats(
        '2025-01-01',
        '2025-01-31',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        stats: mockEventTypeStats,
        period: {
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        },
        generatedAt: expect.any(String),
        generatedBy: 'admin-123',
      });
      expect(service.getEventTypeStats).toHaveBeenCalledWith(
        '2025-01-01',
        '2025-01-31',
      );
    });

    it('should handle no date parameters', async () => {
      // Arrange
      service.getEventTypeStats.mockResolvedValue(mockEventTypeStats);

      // Act
      const result = await controller.getEventTypeStats();

      // Assert
      expect(result.period.startDate).toBeUndefined();
      expect(result.period.endDate).toBeUndefined();
      expect(service.getEventTypeStats).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });
  });

  describe('getAdminActionLogs', () => {
    it('should return admin action logs', async () => {
      // Arrange
      const adminLog = { ...mockAuditLog, eventType: 'TIER_CREATED' };
      service.getAdminActionLogs.mockResolvedValue([adminLog]);

      // Act
      const result = await controller.getAdminActionLogs(
        'admin-123',
        'target-admin-456',
        '25',
        '10',
      );

      // Assert
      expect(result).toEqual({
        logs: [adminLog],
        targetAdminId: 'target-admin-456',
        limit: 25,
        offset: 10,
        retrievedAt: expect.any(String),
        retrievedBy: 'admin-123',
      });
      expect(service.getAdminActionLogs).toHaveBeenCalledWith(
        'target-admin-456',
        25,
        10,
      );
    });

    it('should use default parameters', async () => {
      // Arrange
      service.getAdminActionLogs.mockResolvedValue([]);

      // Act
      const result = await controller.getAdminActionLogs();

      // Assert
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
      expect(service.getAdminActionLogs).toHaveBeenCalledWith(undefined, 50, 0);
    });
  });

  describe('searchAuditLogs', () => {
    it('should search audit logs', async () => {
      // Arrange
      service.searchAuditLogs.mockResolvedValue([mockAuditLog]);

      // Act
      const result = await controller.searchAuditLogs(
        'SUBSCRIPTION',
        '10',
        '0',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        logs: [mockAuditLog],
        searchTerm: 'SUBSCRIPTION',
        limit: 10,
        offset: 0,
        searchedAt: expect.any(String),
        searchedBy: 'admin-123',
      });
      expect(service.searchAuditLogs).toHaveBeenCalledWith(
        'SUBSCRIPTION',
        10,
        0,
      );
    });

    it('should handle empty search term', async () => {
      // Act
      const result = await controller.searchAuditLogs('');

      // Assert
      expect(result).toEqual({
        logs: [],
        searchTerm: '',
        message: '검색어를 입력해주세요.',
      });
      expect(service.searchAuditLogs).not.toHaveBeenCalled();
    });
  });

  describe('getAuditLogDetail', () => {
    it('should return audit log detail', async () => {
      // Arrange
      service.getAuditLogDetail.mockResolvedValue(mockAuditLog);

      // Act
      const result = await controller.getAuditLogDetail('log-123', 'admin-123');

      // Assert
      expect(result).toEqual({
        log: mockAuditLog,
        retrievedAt: expect.any(String),
        retrievedBy: 'admin-123',
      });
      expect(service.getAuditLogDetail).toHaveBeenCalledWith('log-123');
    });

    it('should handle log not found', async () => {
      // Arrange
      service.getAuditLogDetail.mockResolvedValue(null);

      // Act
      const result = await controller.getAuditLogDetail(
        'nonexistent',
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        log: null,
        message: '해당 감사 로그를 찾을 수 없습니다.',
        logId: 'nonexistent',
      });
    });
  });

  describe('cleanupOldLogs', () => {
    it('should cleanup old logs', async () => {
      // Arrange
      service.cleanupOldLogs.mockResolvedValue(100);

      // Act
      const result = await controller.cleanupOldLogs('180', 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '180일 이전의 감사 로그가 정리되었습니다.',
        deletedCount: 100,
        retentionDays: 180,
        cleanedUpAt: expect.any(String),
        cleanedUpBy: 'admin-123',
      });
      expect(service.cleanupOldLogs).toHaveBeenCalledWith(180);
    });

    it('should use default retention days', async () => {
      // Arrange
      service.cleanupOldLogs.mockResolvedValue(50);

      // Act
      const result = await controller.cleanupOldLogs(undefined, 'admin-123');

      // Assert
      expect(result.retentionDays).toBe(365);
      expect(service.cleanupOldLogs).toHaveBeenCalledWith(365);
    });
  });

  describe('getDashboardData', () => {
    it('should return dashboard data for week period', async () => {
      // Arrange
      service.getEventTypeStats.mockResolvedValue(mockEventTypeStats);
      service.getAdminActionLogs.mockResolvedValue([mockAuditLog]);

      // Act
      const result = await controller.getDashboardData('week', 'admin-123');

      // Assert
      expect(result).toEqual({
        period: 'week',
        dateRange: {
          startDate: expect.any(String),
          endDate: expect.any(String),
        },
        eventTypeStats: mockEventTypeStats,
        recentAdminActions: [mockAuditLog],
        generatedAt: expect.any(String),
        generatedBy: 'admin-123',
      });
      expect(service.getEventTypeStats).toHaveBeenCalled();
      expect(service.getAdminActionLogs).toHaveBeenCalledWith(undefined, 10, 0);
    });

    it('should handle different periods', async () => {
      // Arrange
      service.getEventTypeStats.mockResolvedValue([]);
      service.getAdminActionLogs.mockResolvedValue([]);

      // Act
      const dayResult = await controller.getDashboardData('day');
      const monthResult = await controller.getDashboardData('month');

      // Assert
      expect(dayResult.period).toBe('day');
      expect(monthResult.period).toBe('month');
    });

    it('should use default period', async () => {
      // Arrange
      service.getEventTypeStats.mockResolvedValue([]);
      service.getAdminActionLogs.mockResolvedValue([]);

      // Act
      const result = await controller.getDashboardData();

      // Assert
      expect(result.period).toBe('week');
    });
  });
});
