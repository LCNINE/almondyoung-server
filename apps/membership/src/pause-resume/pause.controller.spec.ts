import { Test, TestingModule } from '@nestjs/testing';
import { PauseController } from './pause.controller';
import { PauseService } from './pause.service';
import {
  SubscriptionNotFoundException,
  SubscriptionPausedException,
  PauseQuotaExceededException,
} from '../shared/exceptions/subscription.exceptions';

describe('PauseController', () => {
  let controller: PauseController;
  let service: jest.Mocked<PauseService>;

  const mockPauseRequest = {
    startDate: '2024-01-15T00:00:00.000Z',
    endDate: '2024-01-22T00:00:00.000Z',
    reason: '휴가',
  };

  const mockResumeRequest = {
    reason: '휴가 종료',
  };

  const mockPauseResponse = {
    pauseId: 'pause-123',
    startDate: '2024-01-15T00:00:00.000Z',
    endDate: '2024-01-22T00:00:00.000Z',
    affectedRightsCount: 1,
    remainingPauseQuota: 1,
    eventPayload: {
      pauseId: 'pause-123',
      startDate: '2024-01-15T00:00:00.000Z',
      endDate: '2024-01-22T00:00:00.000Z',
      reason: '휴가',
      affectedRightsCount: 1,
      pauseDays: 7,
    },
  };

  const mockResumeResponse = {
    resumedAt: new Date('2024-01-20T00:00:00.000Z'),
    extensionDays: 7,
    newEndDate: '2024-02-07',
    eventPayload: {
      pauseId: 'pause-123',
      originalEndDate: '2024-01-22',
      actualResumedDate: '2024-01-20',
      extensionDays: 7,
      reason: '휴가 종료',
    },
  };

  const mockPauseHistory = [
    {
      id: 'pause-123',
      startsAt: '2024-01-15',
      endsAt: '2024-01-22',
      actualResumedAt: '2024-01-20',
      status: 'ENDED' as const,
      createdAt: '2024-01-15T00:00:00.000Z',
    },
  ];

  const mockEligibility = {
    eligible: true,
    currentUsage: 1,
    maxPauses: 2,
    remainingPauses: 1,
  };

  beforeEach(async () => {
    const mockService = {
      pauseSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
      getPauseHistory: jest.fn(),
      checkPauseEligibility: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PauseController],
      providers: [
        {
          provide: PauseService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PauseController>(PauseController);
    service = module.get(PauseService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('pauseSubscription', () => {
    it('should pause subscription successfully', async () => {
      // Arrange
      service.pauseSubscription.mockResolvedValue(mockPauseResponse);

      // Act
      const result = await controller.pauseSubscription(
        mockPauseRequest,
        'user-123',
      );

      // Assert
      expect(result).toEqual(mockPauseResponse);
      expect(service.pauseSubscription).toHaveBeenCalledWith('user-123', {
        startDate: mockPauseRequest.startDate,
        endDate: mockPauseRequest.endDate,
        reason: mockPauseRequest.reason,
      });
    });

    it('should throw SubscriptionNotFoundException when no active subscription', async () => {
      // Arrange
      service.pauseSubscription.mockRejectedValue(
        new SubscriptionNotFoundException(),
      );

      // Act & Assert
      await expect(
        controller.pauseSubscription(mockPauseRequest, 'user-123'),
      ).rejects.toThrow(SubscriptionNotFoundException);
    });

    it('should throw SubscriptionPausedException when already paused', async () => {
      // Arrange
      service.pauseSubscription.mockRejectedValue(
        new SubscriptionPausedException('이미 일시정지 중입니다'),
      );

      // Act & Assert
      await expect(
        controller.pauseSubscription(mockPauseRequest, 'user-123'),
      ).rejects.toThrow(SubscriptionPausedException);
    });

    it('should throw PauseQuotaExceededException when quota exceeded', async () => {
      // Arrange
      service.pauseSubscription.mockRejectedValue(
        new PauseQuotaExceededException(2, 2),
      );

      // Act & Assert
      await expect(
        controller.pauseSubscription(mockPauseRequest, 'user-123'),
      ).rejects.toThrow(PauseQuotaExceededException);
    });
  });

  describe('resumeSubscription', () => {
    it('should resume subscription successfully', async () => {
      // Arrange
      service.resumeSubscription.mockResolvedValue(mockResumeResponse);

      // Act
      const result = await controller.resumeSubscription(
        mockResumeRequest,
        'user-123',
      );

      // Assert
      expect(result).toEqual(mockResumeResponse);
      expect(service.resumeSubscription).toHaveBeenCalledWith('user-123', {
        reason: mockResumeRequest.reason,
      });
    });

    it('should throw error when no active pause', async () => {
      // Arrange
      service.resumeSubscription.mockRejectedValue(
        new Error('활성 일시정지가 없습니다'),
      );

      // Act & Assert
      await expect(
        controller.resumeSubscription(mockResumeRequest, 'user-123'),
      ).rejects.toThrow('활성 일시정지가 없습니다');
    });
  });

  describe('getPauseHistory', () => {
    it('should return pause history', async () => {
      // Arrange
      service.getPauseHistory.mockResolvedValue(mockPauseHistory);

      // Act
      const result = await controller.getPauseHistory('user-123');

      // Assert
      expect(result).toEqual(mockPauseHistory);
      expect(service.getPauseHistory).toHaveBeenCalledWith('user-123');
    });

    it('should return empty array when no history', async () => {
      // Arrange
      service.getPauseHistory.mockResolvedValue([]);

      // Act
      const result = await controller.getPauseHistory('user-123');

      // Assert
      expect(result).toEqual([]);
      expect(service.getPauseHistory).toHaveBeenCalledWith('user-123');
    });
  });

  describe('checkPauseEligibility', () => {
    it('should return eligibility information', async () => {
      // Arrange
      service.checkPauseEligibility.mockResolvedValue(mockEligibility);

      // Act
      const result = await controller.checkPauseEligibility('user-123');

      // Assert
      expect(result).toEqual(mockEligibility);
      expect(service.checkPauseEligibility).toHaveBeenCalledWith(
        null,
        'user-123',
        new Date().getFullYear(),
      );
    });

    it('should use provided year parameter', async () => {
      // Arrange
      service.checkPauseEligibility.mockResolvedValue(mockEligibility);

      // Act
      const result = await controller.checkPauseEligibility('user-123', '2023');

      // Assert
      expect(result).toEqual(mockEligibility);
      expect(service.checkPauseEligibility).toHaveBeenCalledWith(
        null,
        'user-123',
        2023,
      );
    });

    it('should return ineligible when quota exceeded', async () => {
      // Arrange
      const ineligibleResponse = {
        eligible: false,
        currentUsage: 2,
        maxPauses: 2,
        remainingPauses: 0,
      };
      service.checkPauseEligibility.mockResolvedValue(ineligibleResponse);

      // Act
      const result = await controller.checkPauseEligibility('user-123');

      // Assert
      expect(result).toEqual(ineligibleResponse);
      expect(result.eligible).toBe(false);
      expect(result.remainingPauses).toBe(0);
    });
  });
});
