import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionNotFoundException } from '../shared/exceptions/subscription.exceptions';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let service: jest.Mocked<SubscriptionService>;

  const mockCurrentSubscription = {
    id: 'sub-123',
    status: 'ACTIVE' as const,
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
  };

  const mockSubscriptionHistory = [
    {
      id: 'sub-123',
      planId: 'plan-123',
      tierCode: 'PREMIUM',
      tierName: 'Premium',
      status: 'ACTIVE' as const,
      startedAt: '2024-01-01',
      endedAt: null,
      changeType: 'INITIAL' as const,
      adjustmentAmount: 0,
      price: 10000,
      currency: 'KRW',
      durationDays: 30,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    const mockService = {
      getCurrentSubscription: jest.fn(),
      createSubscription: jest.fn(),
      upgradeSubscription: jest.fn(),
      downgradeSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      getSubscriptionHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        {
          provide: SubscriptionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    service = module.get(SubscriptionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCurrentSubscription', () => {
    it('should return current subscription', async () => {
      // Arrange
      service.getCurrentSubscription.mockResolvedValue(mockCurrentSubscription);

      // Act
      const result = await controller.getCurrentSubscription('user-123');

      // Assert
      expect(result).toEqual(mockCurrentSubscription);
      expect(service.getCurrentSubscription).toHaveBeenCalledWith('user-123');
    });

    it('should return null when no active subscription', async () => {
      // Arrange
      service.getCurrentSubscription.mockResolvedValue(null);

      // Act
      const result = await controller.getCurrentSubscription('user-123');

      // Assert
      expect(result).toBeNull();
      expect(service.getCurrentSubscription).toHaveBeenCalledWith('user-123');
    });
  });

  describe('createSubscription', () => {
    it('should create subscription successfully', async () => {
      // Arrange
      const createDto = { planId: 'plan-123' };
      const mockResult = { subscriptionId: 'sub-123', rightId: 'right-123' };
      service.createSubscription.mockResolvedValue(mockResult);

      // Act
      const result = await controller.createSubscription(createDto, 'user-123');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.createSubscription).toHaveBeenCalledWith('user-123', 'plan-123');
    });
  });

  describe('upgradeSubscription', () => {
    it('should upgrade subscription successfully', async () => {
      // Arrange
      const upgradeDto = { newPlanId: 'new-plan-123' };
      const mockResult = {
        newSubscriptionId: 'new-sub-123',
        adjustmentAmount: 5000,
        effectiveDate: new Date(),
      };
      service.upgradeSubscription.mockResolvedValue(mockResult);

      // Act
      const result = await controller.upgradeSubscription(upgradeDto, 'user-123');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.upgradeSubscription).toHaveBeenCalledWith('user-123', 'new-plan-123');
    });

    it('should throw SubscriptionNotFoundException when no active subscription', async () => {
      // Arrange
      const upgradeDto = { newPlanId: 'new-plan-123' };
      service.upgradeSubscription.mockRejectedValue(new SubscriptionNotFoundException());

      // Act & Assert
      await expect(
        controller.upgradeSubscription(upgradeDto, 'user-123')
      ).rejects.toThrow(SubscriptionNotFoundException);
    });
  });

  describe('downgradeSubscription', () => {
    it('should schedule downgrade successfully', async () => {
      // Arrange
      const downgradeDto = { newPlanId: 'basic-plan-123' };
      const mockResult = {
        scheduledDate: '2024-02-01',
        currentPlan: { 
          id: 'plan-123', 
          price: 10000,
          durationDays: 30,
          currency: 'KRW'
        },
        scheduledPlan: { 
          id: 'basic-plan-123', 
          tierId: 'tier-basic',
          price: 5000,
          durationDays: 30,
          currency: 'KRW',
          isActive: true,
          trialDays: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };
      service.downgradeSubscription.mockResolvedValue(mockResult);

      // Act
      const result = await controller.downgradeSubscription(downgradeDto, 'user-123');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.downgradeSubscription).toHaveBeenCalledWith('user-123', 'basic-plan-123');
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription successfully', async () => {
      // Arrange
      const cancelDto = { reason: 'User requested cancellation' };
      const mockResult = {
        cancelledAt: new Date(),
        effectiveUntil: '2024-01-31',
      };
      service.cancelSubscription.mockResolvedValue(mockResult);

      // Act
      const result = await controller.cancelSubscription(cancelDto, 'user-123');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.cancelSubscription).toHaveBeenCalledWith('user-123', 'User requested cancellation');
    });

    it('should cancel subscription without reason', async () => {
      // Arrange
      const cancelDto = {};
      const mockResult = {
        cancelledAt: new Date(),
        effectiveUntil: '2024-01-31',
      };
      service.cancelSubscription.mockResolvedValue(mockResult);

      // Act
      const result = await controller.cancelSubscription(cancelDto, 'user-123');

      // Assert
      expect(result).toEqual(mockResult);
      expect(service.cancelSubscription).toHaveBeenCalledWith('user-123', undefined);
    });
  });

  describe('getSubscriptionHistory', () => {
    it('should return subscription history', async () => {
      // Arrange
      service.getSubscriptionHistory.mockResolvedValue(mockSubscriptionHistory);

      // Act
      const result = await controller.getSubscriptionHistory('user-123');

      // Assert
      expect(result).toEqual(mockSubscriptionHistory);
      expect(service.getSubscriptionHistory).toHaveBeenCalledWith('user-123');
    });

    it('should return empty array when no history', async () => {
      // Arrange
      service.getSubscriptionHistory.mockResolvedValue([]);

      // Act
      const result = await controller.getSubscriptionHistory('user-123');

      // Assert
      expect(result).toEqual([]);
      expect(service.getSubscriptionHistory).toHaveBeenCalledWith('user-123');
    });
  });
});