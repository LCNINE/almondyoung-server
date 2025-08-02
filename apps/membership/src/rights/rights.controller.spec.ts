import { Test, TestingModule } from '@nestjs/testing';
import { RightsController } from './rights.controller';
import { RightsService } from './rights.service';
import { RightsNotFoundException } from '../shared/exceptions/subscription.exceptions';

describe('RightsController', () => {
  let controller: RightsController;
  let service: jest.Mocked<RightsService>;

  const mockUserRights = {
    userId: 'user-123',
    tierId: 'tier-123',
    startsAt: '2025-01-01',
    endsAt: '2025-12-31',
    isActive: true,
    pausedAt: null,
    tierCode: 'PREMIUM',
    isPaused: false,
  };

  const mockBulkCheckResults = {
    'user-123': {
      hasActiveSubscription: true,
      tierCode: 'PREMIUM',
      isPaused: false,
      expiresAt: '2025-12-31',
    },
    'user-456': {
      hasActiveSubscription: false,
    },
  };

  beforeEach(async () => {
    const mockService = {
      getUserRights: jest.fn(),
      validateUserRights: jest.fn(),
      bulkCheckSubscriptions: jest.fn(),
      extendUserRights: jest.fn(),
      terminateUserRights: jest.fn(),
      pauseUserRights: jest.fn(),
      resumeUserRights: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RightsController],
      providers: [
        {
          provide: RightsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<RightsController>(RightsController);
    service = module.get(RightsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUserRights', () => {
    it('should return user rights', async () => {
      // Arrange
      service.getUserRights.mockResolvedValue(mockUserRights);

      // Act
      const result = await controller.getUserRights('user-123');

      // Assert
      expect(result).toEqual(mockUserRights);
      expect(service.getUserRights).toHaveBeenCalledWith('user-123');
    });

    it('should return null when no rights exist', async () => {
      // Arrange
      service.getUserRights.mockResolvedValue(null);

      // Act
      const result = await controller.getUserRights('user-123');

      // Assert
      expect(result).toBeNull();
      expect(service.getUserRights).toHaveBeenCalledWith('user-123');
    });
  });

  describe('validateUserRights', () => {
    it('should validate user rights successfully', async () => {
      // Arrange
      service.validateUserRights.mockResolvedValue(true);
      const request = {
        userId: 'user-123',
        requiredTierLevel: 3,
      };

      // Act
      const result = await controller.validateUserRights(request);

      // Assert
      expect(result).toEqual({
        userId: 'user-123',
        isValid: true,
        requiredTierLevel: 3,
        validatedAt: expect.any(String),
      });
      expect(service.validateUserRights).toHaveBeenCalledWith('user-123', 3);
    });

    it('should return false for invalid rights', async () => {
      // Arrange
      service.validateUserRights.mockResolvedValue(false);
      const request = {
        userId: 'user-123',
        requiredTierLevel: 5,
      };

      // Act
      const result = await controller.validateUserRights(request);

      // Assert
      expect(result).toEqual({
        userId: 'user-123',
        isValid: false,
        requiredTierLevel: 5,
        validatedAt: expect.any(String),
      });
      expect(service.validateUserRights).toHaveBeenCalledWith('user-123', 5);
    });

    it('should validate without tier level requirement', async () => {
      // Arrange
      service.validateUserRights.mockResolvedValue(true);
      const request = {
        userId: 'user-123',
      };

      // Act
      const result = await controller.validateUserRights(request);

      // Assert
      expect(result).toEqual({
        userId: 'user-123',
        isValid: true,
        requiredTierLevel: undefined,
        validatedAt: expect.any(String),
      });
      expect(service.validateUserRights).toHaveBeenCalledWith(
        'user-123',
        undefined,
      );
    });
  });

  describe('bulkCheckSubscriptions', () => {
    it('should return bulk check results', async () => {
      // Arrange
      service.bulkCheckSubscriptions.mockResolvedValue(mockBulkCheckResults);
      const request = {
        userIds: ['user-123', 'user-456'],
      };

      // Act
      const result = await controller.bulkCheckSubscriptions(request);

      // Assert
      expect(result).toEqual({
        results: mockBulkCheckResults,
        checkedAt: expect.any(String),
        totalUsers: 2,
        activeSubscriptions: 1,
      });
      expect(service.bulkCheckSubscriptions).toHaveBeenCalledWith([
        'user-123',
        'user-456',
      ]);
    });

    it('should handle empty results', async () => {
      // Arrange
      const emptyResults = {
        'user-789': {
          hasActiveSubscription: false,
        },
      };
      service.bulkCheckSubscriptions.mockResolvedValue(emptyResults);
      const request = {
        userIds: ['user-789'],
      };

      // Act
      const result = await controller.bulkCheckSubscriptions(request);

      // Assert
      expect(result).toEqual({
        results: emptyResults,
        checkedAt: expect.any(String),
        totalUsers: 1,
        activeSubscriptions: 0,
      });
    });
  });

  describe('extendUserRights', () => {
    it('should extend user rights successfully', async () => {
      // Arrange
      service.extendUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
        additionalDays: 30,
        reason: 'Bonus extension',
      };

      // Act
      const result = await controller.extendUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 30일 연장되었습니다.',
        extendedBy: 'admin-123',
        extendedAt: expect.any(String),
      });
      expect(service.extendUserRights).toHaveBeenCalledWith(
        'user-123',
        30,
        'Bonus extension',
      );
    });

    it('should throw error when no rights to extend', async () => {
      // Arrange
      service.extendUserRights.mockRejectedValue(new RightsNotFoundException());
      const request = {
        userId: 'user-123',
        additionalDays: 30,
        reason: 'Bonus extension',
      };

      // Act & Assert
      await expect(
        controller.extendUserRights(request, 'admin-123'),
      ).rejects.toThrow(RightsNotFoundException);
    });
  });

  describe('terminateUserRights', () => {
    it('should terminate user rights successfully', async () => {
      // Arrange
      service.terminateUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
        reason: 'Policy violation',
      };

      // Act
      const result = await controller.terminateUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 종료되었습니다.',
        terminatedBy: 'admin-123',
        terminatedAt: expect.any(String),
        reason: 'Policy violation',
      });
      expect(service.terminateUserRights).toHaveBeenCalledWith(
        'user-123',
        'Policy violation',
      );
    });

    it('should throw error when no rights to terminate', async () => {
      // Arrange
      service.terminateUserRights.mockRejectedValue(
        new RightsNotFoundException(),
      );
      const request = {
        userId: 'user-123',
        reason: 'Policy violation',
      };

      // Act & Assert
      await expect(
        controller.terminateUserRights(request, 'admin-123'),
      ).rejects.toThrow(RightsNotFoundException);
    });
  });

  describe('pauseUserRights', () => {
    it('should pause user rights successfully', async () => {
      // Arrange
      service.pauseUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
        pausedAt: '2025-01-15T00:00:00.000Z',
      };

      // Act
      const result = await controller.pauseUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 일시정지되었습니다.',
        pausedBy: 'admin-123',
        pausedAt: '2025-01-15T00:00:00.000Z',
      });
      expect(service.pauseUserRights).toHaveBeenCalledWith(
        'user-123',
        new Date('2025-01-15T00:00:00.000Z'),
      );
    });

    it('should pause user rights with current date when no date provided', async () => {
      // Arrange
      service.pauseUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
      };

      // Act
      const result = await controller.pauseUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 일시정지되었습니다.',
        pausedBy: 'admin-123',
        pausedAt: expect.any(String),
      });
      expect(service.pauseUserRights).toHaveBeenCalledWith(
        'user-123',
        expect.any(Date),
      );
    });
  });

  describe('resumeUserRights', () => {
    it('should resume user rights successfully', async () => {
      // Arrange
      service.resumeUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
        newEndsAt: '2025-12-31T00:00:00.000Z',
      };

      // Act
      const result = await controller.resumeUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 재개되었습니다.',
        resumedBy: 'admin-123',
        resumedAt: expect.any(String),
        newEndsAt: '2025-12-31T00:00:00.000Z',
      });
      expect(service.resumeUserRights).toHaveBeenCalledWith(
        'user-123',
        new Date('2025-12-31T00:00:00.000Z'),
      );
    });

    it('should resume user rights without new end date', async () => {
      // Arrange
      service.resumeUserRights.mockResolvedValue(undefined);
      const request = {
        userId: 'user-123',
      };

      // Act
      const result = await controller.resumeUserRights(request, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        message: '사용자 user-123의 권한이 재개되었습니다.',
        resumedBy: 'admin-123',
        resumedAt: expect.any(String),
        newEndsAt: undefined,
      });
      expect(service.resumeUserRights).toHaveBeenCalledWith(
        'user-123',
        undefined,
      );
    });
  });

  describe('getRightsStats', () => {
    it('should return stats placeholder', async () => {
      // Act
      const result = await controller.getRightsStats('admin-123');

      // Assert
      expect(result).toEqual({
        message: '권한 통계 기능은 추후 구현 예정입니다.',
        requestedBy: 'admin-123',
        requestedAt: expect.any(String),
      });
    });
  });
});
