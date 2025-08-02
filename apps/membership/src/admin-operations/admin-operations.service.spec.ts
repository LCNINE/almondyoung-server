import { Test, TestingModule } from '@nestjs/testing';
import { AdminOperationsService } from './admin-operations.service';
import { PlanService } from '../plan/plan.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { EventPublisherService } from '@app/events';

describe('AdminOperationsService', () => {
  let service: AdminOperationsService;
  let planService: jest.Mocked<PlanService>;
  // Note: subscriptionService and eventPublisher are available but not used in current tests

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

  beforeEach(async () => {
    const mockPlanService = {
      createTier: jest.fn(),
      updateTier: jest.fn(),
      createPlan: jest.fn(),
      updatePlan: jest.fn(),
      deactivatePlan: jest.fn(),
      getAllTiers: jest.fn(),
      getPlanDetails: jest.fn(),
      getPlansByTier: jest.fn(),
    };

    const mockSubscriptionService = {
      getActiveSubscriptionsByPlan: jest.fn(),
      getSubscriptionCountByPlan: jest.fn(),
    };

    const mockEventPublisher = {
      publishEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOperationsService,
        {
          provide: PlanService,
          useValue: mockPlanService,
        },
        {
          provide: SubscriptionService,
          useValue: mockSubscriptionService,
        },
        {
          provide: EventPublisherService,
          useValue: mockEventPublisher,
        },
      ],
    }).compile();

    service = module.get<AdminOperationsService>(AdminOperationsService);
    planService = module.get(PlanService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTier', () => {
    const createTierDto = {
      code: 'PREMIUM',
      name: 'Premium',
      priorityLevel: 3,
    };

    it('should create tier successfully', async () => {
      // Arrange
      planService.createTier.mockResolvedValue({
        tierId: '550e8400-e29b-41d4-a716-446655440000',
      });

      // Act
      const result = await service.createTier(createTierDto, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        tierId: '550e8400-e29b-41d4-a716-446655440000',
        message: "티어 'Premium'이 성공적으로 생성되었습니다.",
      });
      expect(planService.createTier).toHaveBeenCalledWith(
        createTierDto,
        'admin-123',
      );
    });

    it('should handle tier creation failure', async () => {
      // Arrange
      const error = new Error('티어 코드가 이미 존재합니다');
      planService.createTier.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.createTier(createTierDto, 'admin-123'),
      ).rejects.toThrow('티어 코드가 이미 존재합니다');
    });

    it('should validate tier code format', async () => {
      // Arrange
      const invalidTierDto = {
        code: 'invalid-code',
        name: 'Invalid',
        priorityLevel: 3,
      };

      // Act & Assert
      await expect(
        service.createTier(invalidTierDto, 'admin-123'),
      ).rejects.toThrow(
        '티어 코드는 대문자와 언더스코어만 사용할 수 있습니다.',
      );
    });

    it('should validate priority level range - too high', async () => {
      // Arrange
      const invalidTierDto = {
        code: 'INVALID',
        name: 'Invalid',
        priorityLevel: 101,
      };

      // Act & Assert
      await expect(
        service.createTier(invalidTierDto, 'admin-123'),
      ).rejects.toThrow('우선순위는 1-100 사이의 값이어야 합니다.');
    });

    it('should validate priority level range - too low', async () => {
      // Arrange
      const invalidTierDto = {
        code: 'INVALID',
        name: 'Invalid',
        priorityLevel: 0,
      };

      // Act & Assert
      await expect(
        service.createTier(invalidTierDto, 'admin-123'),
      ).rejects.toThrow('우선순위는 1-100 사이의 값이어야 합니다.');
    });

    it('should validate tier code with special characters', async () => {
      // Arrange
      const invalidTierDto = {
        code: 'PREMIUM@',
        name: 'Premium',
        priorityLevel: 3,
      };

      // Act & Assert
      await expect(
        service.createTier(invalidTierDto, 'admin-123'),
      ).rejects.toThrow(
        '티어 코드는 대문자와 언더스코어만 사용할 수 있습니다.',
      );
    });
  });

  describe('updateTier', () => {
    const updateTierDto = {
      name: 'Updated Premium',
      priorityLevel: 4,
    };

    it('should update tier successfully', async () => {
      // Arrange
      planService.getAllTiers.mockResolvedValue([mockTier]);
      planService.updateTier.mockResolvedValue({ tierId: 'tier-123' });
      planService.getPlansByTier.mockResolvedValue([]);

      // Act
      const result = await service.updateTier(
        'tier-123',
        updateTierDto,
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        success: true,
        tierId: 'tier-123',
        message: '티어가 성공적으로 수정되었습니다.',
        impactAnalysis: {
          affectedPlansCount: 0,
          affectedPlans: [],
          changes: updateTierDto,
        },
      });
    });

    it('should throw error for non-existent tier', async () => {
      // Arrange
      planService.getAllTiers.mockResolvedValue([]);

      // Act & Assert
      await expect(
        service.updateTier('non-existent', updateTierDto, 'admin-123'),
      ).rejects.toThrow('존재하지 않는 티어입니다.');
    });

    it('should show impact analysis with affected plans', async () => {
      // Arrange
      const affectedPlans = [
        { id: 'plan-1', price: 10000, durationDays: 30 },
        { id: 'plan-2', price: 20000, durationDays: 60 },
      ];

      planService.getAllTiers.mockResolvedValue([mockTier]);
      planService.updateTier.mockResolvedValue({ tierId: 'tier-123' });
      planService.getPlansByTier.mockResolvedValue(affectedPlans);

      // Act
      const result = await service.updateTier(
        'tier-123',
        updateTierDto,
        'admin-123',
      );

      // Assert
      expect(result.impactAnalysis).toEqual({
        affectedPlansCount: 2,
        affectedPlans: affectedPlans,
        changes: updateTierDto,
      });
      expect(planService.getPlansByTier).toHaveBeenCalledWith('tier-123');
    });

    it('should handle tier update failure', async () => {
      // Arrange
      planService.getAllTiers.mockResolvedValue([mockTier]);
      planService.getPlansByTier.mockResolvedValue([]); // Mock this to prevent undefined error
      const error = new Error('티어 수정 중 오류 발생');
      planService.updateTier.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.updateTier('tier-123', updateTierDto, 'admin-123'),
      ).rejects.toThrow('티어 수정 중 오류 발생');
    });
  });

  describe('createPlan', () => {
    const createPlanDto = {
      tierId: 'tier-123',
      price: 10000,
      durationDays: 30,
      currency: 'KRW',
      trialDays: 7,
    };

    it('should create plan successfully', async () => {
      // Arrange
      planService.createPlan.mockResolvedValue({
        planId: '550e8400-e29b-41d4-a716-446655440001',
      });

      // Act
      const result = await service.createPlan(createPlanDto, 'admin-123');

      // Assert
      expect(result).toEqual({
        success: true,
        planId: '550e8400-e29b-41d4-a716-446655440001',
        message: '플랜이 성공적으로 생성되었습니다.',
      });
      expect(planService.createPlan).toHaveBeenCalledWith(
        createPlanDto,
        'admin-123',
      );
    });

    it('should validate negative price', async () => {
      // Arrange
      const invalidPlanDto = {
        ...createPlanDto,
        price: -1000,
      };

      // Act & Assert
      await expect(
        service.createPlan(invalidPlanDto, 'admin-123'),
      ).rejects.toThrow('가격은 0 이상이어야 합니다.');
    });

    it('should validate duration days', async () => {
      // Arrange
      const invalidPlanDto = {
        ...createPlanDto,
        durationDays: 0,
      };

      // Act & Assert
      await expect(
        service.createPlan(invalidPlanDto, 'admin-123'),
      ).rejects.toThrow('기간은 1일 이상이어야 합니다.');
    });

    it('should validate trial days vs duration', async () => {
      // Arrange
      const invalidPlanDto = {
        ...createPlanDto,
        durationDays: 10,
        trialDays: 15,
      };

      // Act & Assert
      await expect(
        service.createPlan(invalidPlanDto, 'admin-123'),
      ).rejects.toThrow('무료 체험 기간은 전체 기간보다 짧아야 합니다.');
    });
  });

  describe('updatePlan', () => {
    const updatePlanDto = {
      price: 15000,
      durationDays: 60,
    };

    it('should update plan successfully', async () => {
      // Arrange
      planService.getPlanDetails.mockResolvedValue(mockPlan);
      planService.updatePlan.mockResolvedValue({ planId: 'plan-123' });

      // Act
      const result = await service.updatePlan(
        'plan-123',
        updatePlanDto,
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        success: true,
        planId: 'plan-123',
        message: '플랜이 성공적으로 수정되었습니다.',
        impactAnalysis: {
          estimatedAffectedSubscribers: 0,
          priceChange: 'PRICE_UPDATED',
          durationChange: 'DURATION_UPDATED',
          changes: updatePlanDto,
        },
      });
    });

    it('should handle plan update failure', async () => {
      // Arrange
      const error = new Error('플랜을 찾을 수 없습니다');
      planService.getPlanDetails.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.updatePlan('invalid-plan', updatePlanDto, 'admin-123'),
      ).rejects.toThrow('플랜을 찾을 수 없습니다');
    });
  });

  describe('deactivatePlan', () => {
    const deactivateDto = {
      reason: '더 이상 제공하지 않는 플랜',
    };

    it('should deactivate plan successfully', async () => {
      // Arrange
      planService.getPlanDetails.mockResolvedValue(mockPlan);
      planService.deactivatePlan.mockResolvedValue({ planId: 'plan-123' });

      // Act
      const result = await service.deactivatePlan(
        'plan-123',
        deactivateDto,
        'admin-123',
      );

      // Assert
      expect(result).toEqual({
        success: true,
        planId: 'plan-123',
        message: '플랜이 성공적으로 비활성화되었습니다.',
        impactAnalysis: {
          estimatedAffectedSubscribers: 0,
          alternativePlans: [],
          warning: '플랜 비활성화 후에는 새로운 구독을 받을 수 없습니다.',
        },
      });
    });

    it('should handle plan deactivation failure', async () => {
      // Arrange
      const error = new Error('플랜을 찾을 수 없습니다');
      planService.getPlanDetails.mockRejectedValue(error);

      // Act & Assert
      await expect(
        service.deactivatePlan('invalid-plan', deactivateDto, 'admin-123'),
      ).rejects.toThrow('플랜을 찾을 수 없습니다');
    });
  });
});
