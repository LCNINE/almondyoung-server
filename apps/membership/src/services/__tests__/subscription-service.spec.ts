import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from '../subscription.service';
import { EntitlementService } from '../entitlement.service';
import { PlanService } from '../plan.service';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { SubscriptionCreator } from '../subscription/subscription.creator';
import { SubscriptionManager } from '../subscription/subscription.manager';

describe('SubscriptionService - Layer Refactoring', () => {
  let service: SubscriptionService;

  const mockEntitlementService = {
    checkAndUpdateSubscription: jest.fn(),
    getUserEntitlement: jest.fn(),
  };

  const mockPlanService = {
    getPlanDetails: jest.fn(),
  };

  const mockContractReader = {
    findActiveContract: jest.fn(),
    findPlan: jest.fn(),
    findContractsByUserId: jest.fn(),
  };

  const mockSubscriptionCreator = {
    createNewSubscription: jest.fn(),
  };

  const mockSubscriptionManager = {
    upgradeSubscription: jest.fn(),
    voidSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: EntitlementService,
          useValue: mockEntitlementService,
        },
        {
          provide: PlanService,
          useValue: mockPlanService,
        },
        {
          provide: SubscriptionContractReader,
          useValue: mockContractReader,
        },
        {
          provide: SubscriptionCreator,
          useValue: mockSubscriptionCreator,
        },
        {
          provide: SubscriptionManager,
          useValue: mockSubscriptionManager,
        },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSubscription', () => {
    it('새 구독을 생성해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const planId = 'plan_001';

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockEntitlementService.getUserEntitlement.mockResolvedValue(null);
      mockPlanService.getPlanDetails.mockResolvedValue({
        plan: { id: planId, price: 10000, durationDays: 30 },
        tier: { id: 'tier_001', code: 'PREMIUM' },
      });
      mockSubscriptionCreator.createNewSubscription.mockResolvedValue({
        contractId: 'contract_001',
        entitlementId: 'entitlement_001',
      });

      // When
      const result = await service.createSubscription(userId, planId);

      // Then
      expect(result).toEqual({
        contractId: 'contract_001',
        entitlementId: 'entitlement_001',
      });
      expect(
        mockSubscriptionCreator.createNewSubscription,
      ).toHaveBeenCalledWith(
        userId,
        { id: planId, price: 10000, durationDays: 30 },
        { id: 'tier_001', code: 'PREMIUM' },
      );
    });

    it('기존 구독이 있으면 에러를 발생시켜야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const planId = 'plan_001';

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        entitlement: { id: 'existing' },
      });

      // When & Then
      await expect(
        service.createSubscription(userId, planId),
      ).rejects.toThrow();
    });
  });

  describe('upgradeSubscription', () => {
    it('구독을 업그레이드해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const newPlanId = 'plan_002';

      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        contract: { id: 'contract_001', planId: 'plan_001' },
        tier: { id: 'tier_001', priorityLevel: 1 },
      });
      mockPlanService.getPlanDetails.mockResolvedValue({
        plan: { id: newPlanId, price: 20000, durationDays: 30 },
        tier: { id: 'tier_002', code: 'VIP', priorityLevel: 2 },
      });
      mockSubscriptionManager.upgradeSubscription.mockResolvedValue({
        newEntitlementId: 'entitlement_002',
        effectiveDate: new Date(),
      });

      // When
      const result = await service.upgradeSubscription(userId, newPlanId);

      // Then
      expect(result).toHaveProperty('newEntitlementId');
      expect(mockSubscriptionManager.upgradeSubscription).toHaveBeenCalled();
    });
  });

  describe('getCurrentSubscriptionDetails', () => {
    it('현재 구독 상태를 조회해야 함', async () => {
      // Given
      const userId = 'test_user_001';

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        entitlement: { id: 'entitlement_001' },
        contract: { id: 'contract_001' },
      });

      // When
      const result = await service.getCurrentSubscriptionDetails(userId);

      // Then
      expect(result).toHaveProperty('entitlement');
      expect(
        mockEntitlementService.checkAndUpdateSubscription,
      ).toHaveBeenCalledWith(userId);
    });
  });
});
