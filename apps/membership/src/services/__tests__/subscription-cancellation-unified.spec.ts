import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionCancellationService } from '../subscription-cancellation.service';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { ContractEventService } from '../contract-event.service';
import { EntitlementService } from '../entitlement.service';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { SubscriptionCancellationManager } from '../subscription/subscription-cancellation.manager';

describe('SubscriptionCancellationService - Unified Cancellation', () => {
  let service: SubscriptionCancellationService;
  let entitlementService: EntitlementService;

  const mockDbService = {
    db: {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      transaction: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    },
  };

  const mockContractEventService = {
    addEvent: jest.fn().mockResolvedValue({ id: 1 }),
  };

  const mockEntitlementService = {
    checkAndUpdateSubscription: jest.fn(),
  };

  const mockContractReader = {
    findContractWithPlan: jest.fn(),
    findById: jest.fn(),
    findPlan: jest.fn(),
  };

  const mockCancellationManager = {
    checkRefundEligibility: jest.fn(),
    cancelImmediately: jest.fn(),
    cancelRecurringPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCancellationService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: ContractEventService,
          useValue: mockContractEventService,
        },
        {
          provide: EntitlementService,
          useValue: mockEntitlementService,
        },
        {
          provide: SubscriptionContractReader,
          useValue: mockContractReader,
        },
        {
          provide: SubscriptionCancellationManager,
          useValue: mockCancellationManager,
        },
      ],
    }).compile();

    service = module.get<SubscriptionCancellationService>(
      SubscriptionCancellationService,
    );
    entitlementService = module.get<EntitlementService>(EntitlementService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cancelSubscription - 통합 취소', () => {
    it('활성 구독이 없으면 에러를 발생시켜야 함', async () => {
      // Given
      const userId = 'test_user_001';
      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(
        false,
      );

      // When & Then
      await expect(
        service.cancelSubscription(userId, 'NO_LONGER_NEEDED'),
      ).rejects.toThrow('Active subscription not found');
    });

    it('무료체험 중 취소 시 즉시 취소 + 환불을 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
      };
      const plan = {
        id: 'plan_001',
        price: 10000,
        trialDays: 7,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({
        contract,
        plan,
      });
      mockCancellationManager.checkRefundEligibility.mockReturnValue({
        eligible: true,
        reason: '무료 체험 기간 중 취소',
        amount: 10000,
      });
      mockCancellationManager.cancelImmediately.mockResolvedValue({
        type: 'IMMEDIATE_CANCELLATION',
        contractId: 'contract_001',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: true,
        refundAmount: 10000,
        refundStatus: 'PENDING',
        message: '구독이 즉시 취소되었습니다. 환불이 처리됩니다.',
      });

      // When
      const result = await service.cancelSubscription(
        userId,
        'TRIAL_PERIOD',
        '체험 후 결정',
      );

      // Then
      expect(result.type).toBe('IMMEDIATE_CANCELLATION');
      expect(result.refundEligible).toBe(true);
      if (result.type === 'IMMEDIATE_CANCELLATION') {
        expect(result.refundAmount).toBe(10000);
      }
      expect(result.status).toBe('CANCELLED');
    });

    it('무료체험 후 취소 시 정기결제 중단을 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const billingDate = new Date();
      billingDate.setDate(billingDate.getDate() - 10);

      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: billingDate.toISOString().split('T')[0],
        nextBillingDate: '2025-11-15',
        status: 'ACTIVE',
      };
      const plan = {
        id: 'plan_001',
        price: 10000,
        trialDays: 7,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({
        contract,
        plan,
      });
      mockCancellationManager.checkRefundEligibility.mockReturnValue({
        eligible: false,
        reason: '무료 체험 기간이 지났습니다',
        amount: 0,
      });
      mockCancellationManager.cancelRecurringPayment.mockResolvedValue({
        type: 'RECURRING_CANCELLATION',
        contractId: 'contract_001',
        status: 'RECURRING_CANCELLED',
        recurringCancelledAt: new Date(),
        nextBillingDate: null,
        currentPeriodEndsAt: '2025-11-15',
        autoRenewal: false,
        refundEligible: false,
        message:
          '정기결제가 중단되었습니다. 현재 구독은 2025-11-15까지 유효합니다.',
      });

      // When
      const result = await service.cancelSubscription(
        userId,
        'NO_LONGER_NEEDED',
        '더 이상 필요하지 않음',
      );

      // Then
      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(result.refundEligible).toBe(false);
      if (result.type === 'RECURRING_CANCELLATION') {
        expect(result.autoRenewal).toBe(false);
        expect(result.nextBillingDate).toBeNull();
        expect(result.currentPeriodEndsAt).toBe('2025-11-15');
      }
    });

    it('정기결제 중단 시 Manager의 cancelRecurringPayment를 호출해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const billingDate = new Date();
      billingDate.setDate(billingDate.getDate() - 10);

      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: billingDate.toISOString().split('T')[0],
        nextBillingDate: '2025-11-15',
        status: 'ACTIVE',
      };
      const plan = {
        id: 'plan_001',
        price: 10000,
        trialDays: 7,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({
        contract,
        plan,
      });
      mockCancellationManager.checkRefundEligibility.mockReturnValue({
        eligible: false,
        reason: '무료 체험 기간이 지났습니다',
        amount: 0,
      });
      mockCancellationManager.cancelRecurringPayment.mockResolvedValue({
        type: 'RECURRING_CANCELLATION',
        contractId: 'contract_001',
        status: 'RECURRING_CANCELLED',
        recurringCancelledAt: new Date(),
        nextBillingDate: null,
        currentPeriodEndsAt: '2025-11-15',
        autoRenewal: false,
        refundEligible: false,
        message: '정기결제가 중단되었습니다.',
      });

      // When
      await service.cancelSubscription(userId, 'NO_LONGER_NEEDED');

      // Then
      expect(
        mockCancellationManager.cancelRecurringPayment,
      ).toHaveBeenCalledWith(userId, contract, 'NO_LONGER_NEEDED', undefined);
    });
  });
});
