import { Test, TestingModule } from '@nestjs/testing';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlanNotFoundException } from '../shared/exceptions/subscription.exceptions';

describe('PlanController', () => {
  let controller: PlanController;
  let service: jest.Mocked<PlanService>;

  const mockPlanWithTier = {
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
  };

  const mockPlanDetails = {
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
  };

  const mockTier = {
    id: 'tier-123',
    code: 'PREMIUM',
    name: 'Premium',
    priorityLevel: 3,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockPlan = {
    id: 'plan-123',
    price: 10000,
    durationDays: 30,
    currency: 'KRW',
    trialDays: 7,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  const mockTierBenefits = {
    tier: {
      id: 'tier-123',
      code: 'PREMIUM',
      name: 'Premium',
      priorityLevel: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    plans: [mockPlan],
    benefits: [
      {
        type: 'storage',
        description: 'Premium 티어 스토리지 혜택',
        value: '40GB',
      },
      {
        type: 'support',
        description: 'Premium 티어 지원 혜택',
        value: '24/7 지원',
      },
    ],
  };

  beforeEach(async () => {
    const mockService = {
      getAllPlans: jest.fn(),
      getPlanDetails: jest.fn(),
      getAllTiers: jest.fn(),
      getPlansByTier: jest.fn(),
      getTierBenefits: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanController],
      providers: [
        {
          provide: PlanService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<PlanController>(PlanController);
    service = module.get(PlanService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllPlans', () => {
    it('should return all active plans', async () => {
      // Arrange
      service.getAllPlans.mockResolvedValue([mockPlanWithTier]);

      // Act
      const result = await controller.getAllPlans();

      // Assert
      expect(result).toEqual([mockPlanWithTier]);
      expect(service.getAllPlans).toHaveBeenCalled();
    });

    it('should return empty array when no plans exist', async () => {
      // Arrange
      service.getAllPlans.mockResolvedValue([]);

      // Act
      const result = await controller.getAllPlans();

      // Assert
      expect(result).toEqual([]);
      expect(service.getAllPlans).toHaveBeenCalled();
    });
  });

  describe('getPlanDetails', () => {
    it('should return plan details', async () => {
      // Arrange
      service.getPlanDetails.mockResolvedValue(mockPlanDetails);

      // Act
      const result = await controller.getPlanDetails('plan-123');

      // Assert
      expect(result).toEqual(mockPlanDetails);
      expect(service.getPlanDetails).toHaveBeenCalledWith('plan-123');
    });

    it('should throw PlanNotFoundException when plan does not exist', async () => {
      // Arrange
      service.getPlanDetails.mockRejectedValue(new PlanNotFoundException());

      // Act & Assert
      await expect(controller.getPlanDetails('invalid-plan')).rejects.toThrow(
        PlanNotFoundException,
      );
    });
  });

  describe('getAllTiers', () => {
    it('should return all tiers', async () => {
      // Arrange
      service.getAllTiers.mockResolvedValue([mockTier]);

      // Act
      const result = await controller.getAllTiers();

      // Assert
      expect(result).toEqual([mockTier]);
      expect(service.getAllTiers).toHaveBeenCalled();
    });

    it('should return empty array when no tiers exist', async () => {
      // Arrange
      service.getAllTiers.mockResolvedValue([]);

      // Act
      const result = await controller.getAllTiers();

      // Assert
      expect(result).toEqual([]);
      expect(service.getAllTiers).toHaveBeenCalled();
    });
  });

  describe('getPlansByTier', () => {
    it('should return plans for specific tier', async () => {
      // Arrange
      service.getPlansByTier.mockResolvedValue([mockPlan]);

      // Act
      const result = await controller.getPlansByTier('tier-123');

      // Assert
      expect(result).toEqual([mockPlan]);
      expect(service.getPlansByTier).toHaveBeenCalledWith('tier-123');
    });

    it('should return empty array when tier has no plans', async () => {
      // Arrange
      service.getPlansByTier.mockResolvedValue([]);

      // Act
      const result = await controller.getPlansByTier('tier-123');

      // Assert
      expect(result).toEqual([]);
      expect(service.getPlansByTier).toHaveBeenCalledWith('tier-123');
    });
  });

  describe('getTierBenefits', () => {
    it('should return tier benefits', async () => {
      // Arrange
      service.getTierBenefits.mockResolvedValue(mockTierBenefits);

      // Act
      const result = await controller.getTierBenefits('tier-123');

      // Assert
      expect(result).toEqual(mockTierBenefits);
      expect(service.getTierBenefits).toHaveBeenCalledWith('tier-123');
    });

    it('should throw PlanNotFoundException when tier does not exist', async () => {
      // Arrange
      service.getTierBenefits.mockRejectedValue(new PlanNotFoundException());

      // Act & Assert
      await expect(controller.getTierBenefits('invalid-tier')).rejects.toThrow(
        PlanNotFoundException,
      );
    });
  });
});
