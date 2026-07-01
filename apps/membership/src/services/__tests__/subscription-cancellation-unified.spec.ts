import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionCancellationService } from '../subscription-cancellation.service';
import { DbService } from '@app/db';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { EntitlementService } from '../entitlement.service';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { SubscriptionCancellationManager } from '../subscription/subscription-cancellation.manager';
import { MembershipPolicyService } from '../membership-policy.service';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { CancellationReasonReader } from '../subscription/cancellation-reason.reader';
import { PaymentClientService } from '../billing/payment-client.service';

describe('SubscriptionCancellationService - Unified Cancellation', () => {
  let service: SubscriptionCancellationService;

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

  const mockContractEventManager = {
    addEvent: jest.fn().mockResolvedValue({ id: 1 }),
  };

  const mockEntitlementService = {
    checkAndUpdateSubscription: jest.fn(),
  };

  const mockContractReader = {
    findContractWithPlan: jest.fn(),
    findContractsByUserId: jest.fn(),
    findById: jest.fn(),
    findPlan: jest.fn(),
  };

  const mockCancellationManager = {
    checkRefundEligibility: jest.fn(),
    cancelImmediately: jest.fn(),
    cancelRecurringPayment: jest.fn(),
  };

  const mockPolicyService = {
    getPolicyValue: jest.fn(),
    getNumberPolicy: jest.fn(),
    getBooleanPolicy: jest.fn(),
  };

  const mockMembershipEventPublisher = {
    publishStatusChanged: jest.fn().mockResolvedValue(undefined),
  };

  const mockCancellationReasonReader = {
    findActiveReasons: jest.fn(),
  };

  beforeEach(async () => {
    // 정책 기본값 설정
    mockPolicyService.getBooleanPolicy.mockResolvedValue(true);
    mockPolicyService.getNumberPolicy.mockResolvedValue(24);
    mockPolicyService.getPolicyValue.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCancellationService,
        {
          provide: DbService,
          useValue: mockDbService,
        },
        {
          provide: ContractEventManager,
          useValue: mockContractEventManager,
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
        {
          provide: MembershipPolicyService,
          useValue: mockPolicyService,
        },
        {
          provide: MembershipEventPublisher,
          useValue: mockMembershipEventPublisher,
        },
        {
          provide: CancellationReasonReader,
          useValue: mockCancellationReasonReader,
        },
        {
          provide: PaymentClientService,
          useValue: {
            refundMembershipPayment: jest.fn().mockResolvedValue(undefined),
            revokeBillingAgreement: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionCancellationService>(SubscriptionCancellationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cancelSubscription - 통합 취소', () => {
    it('활성 구독이 없으면 에러를 발생시켜야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const email = 'test@example.com';
      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue(null);
      mockContractReader.findContractsByUserId.mockResolvedValue([]);

      // When & Then
      await expect(service.cancelSubscription(userId, email, 'NO_LONGER_NEEDED')).rejects.toThrow(
        'Active subscription not found',
      );
    });

    it('무료체험 중 취소 시 즉시 취소 + 환불을 반환해야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const email = 'test@example.com';
      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
        createdAt: new Date(),
      };
      const plan = {
        id: 'plan_001',
        tierId: 'tier_001',
        price: 10000,
        trialDays: 7,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({
        contract,
        plan,
      });

      // 정책 설정: 무료 체험 환불 활성화
      mockPolicyService.getBooleanPolicy.mockResolvedValue(true); // TRIAL_REFUND_ENABLED
      mockPolicyService.getNumberPolicy.mockResolvedValue(7); // TRIAL_DURATION_DAYS

      mockCancellationManager.checkRefundEligibility.mockResolvedValue({
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
      const result = await service.cancelSubscription(userId, email, 'TRIAL_PERIOD', '체험 후 결정');

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
      const email = 'test@example.com';
      const billingDate = new Date();
      billingDate.setDate(billingDate.getDate() - 10);

      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: billingDate.toISOString().split('T')[0],
        nextBillingDate: '2025-11-15',
        status: 'ACTIVE',
        createdAt: billingDate,
      };
      const plan = {
        id: 'plan_001',
        tierId: 'tier_001',
        price: 10000,
        trialDays: 7,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({
        contract,
        plan,
      });

      // 정책 설정: 무료 체험 기간 지남
      mockPolicyService.getNumberPolicy.mockResolvedValue(7); // TRIAL_DURATION_DAYS
      mockPolicyService.getBooleanPolicy.mockResolvedValue(true);

      mockCancellationManager.checkRefundEligibility.mockResolvedValue({
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
        message: '정기결제가 중단되었습니다. 현재 구독은 2025-11-15까지 유효합니다.',
      });

      // When
      const result = await service.cancelSubscription(userId, email, 'NO_LONGER_NEEDED', '더 이상 필요하지 않음');

      // Then
      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(result.refundEligible).toBe(false);
      if (result.type === 'RECURRING_CANCELLATION') {
        expect(result.autoRenewal).toBe(false);
        expect(result.nextBillingDate).toBeNull();
        expect(result.currentPeriodEndsAt).toBe('2025-11-15');
      }
    });
  });
});
