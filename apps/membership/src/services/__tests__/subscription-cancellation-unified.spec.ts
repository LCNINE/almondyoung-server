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
import { BenefitReader } from '../benefit/benefit.reader';

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

  const mockPaymentClientService = {
    refundByIntent: jest.fn().mockResolvedValue(undefined),
    revokeBillingAgreement: jest.fn().mockResolvedValue(undefined),
  };

  const mockBenefitReader = {
    findCurrentCycleBenefit: jest.fn(),
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
          useValue: mockPaymentClientService,
        },
        {
          provide: BenefitReader,
          useValue: mockBenefitReader,
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

    it('이번 주기 혜택 미사용 시 즉시 취소 + 결제액 전액 환불 실행', async () => {
      // Given
      const userId = 'test_user_001';
      const email = 'test@example.com';
      const contract = {
        id: 'contract_001',
        userId,
        planId: 'plan_001',
        billingDate: new Date().toISOString().split('T')[0],
        lastPaymentIntentId: 'intent_001',
        autoRenewal: false,
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

      // 이번 주기 혜택 사용 이력 없음 → 환불 대상
      mockBenefitReader.findCurrentCycleBenefit.mockResolvedValue({
        orderCount: 0,
        totalDiscountAmount: 0,
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
      const result = await service.cancelSubscription(userId, email, 'NO_LONGER_NEEDED', '체험 후 결정');

      // Then
      expect(result.type).toBe('IMMEDIATE_CANCELLATION');
      expect(result.status).toBe('CANCELLED');
      // 결제액 전액(plan.price)이 lastPaymentIntentId 로 환불 요청되어야 함
      expect(mockPaymentClientService.refundByIntent).toHaveBeenCalledWith(
        'intent_001',
        10000,
        'NO_LONGER_NEEDED',
        '체험 후 결정',
        undefined,
      );
    });

    it('이번 주기 혜택 사용 시 환불 없이 정기결제 중단만', async () => {
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
        lastPaymentIntentId: 'intent_001',
        autoRenewal: true,
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

      // 이번 주기 혜택 사용 이력 있음 → 환불 불가
      mockBenefitReader.findCurrentCycleBenefit.mockResolvedValue({
        orderCount: 2,
        totalDiscountAmount: 5000,
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
      // 혜택을 사용했으므로 환불은 실행되지 않아야 함
      expect(mockPaymentClientService.refundByIntent).not.toHaveBeenCalled();
    });

    it('재가입한 두번째 멤버십은 현재 계약 billingDate 로만 혜택을 조회 → 이번 주기 미사용이면 전액 환불', async () => {
      // Given: 과거 첫 멤버십에서 웰컴딜을 썼더라도, 두번째(재가입) 멤버십의 현재 주기엔
      // 아무 할인 구매가 없다. 환불 판정은 lifetime 이 아니라 "현재 계약의 현재 주기"만 본다.
      const userId = 'rejoin_user_001';
      const email = 'rejoin@example.com';
      const secondBillingDate = '2025-06-20'; // 재가입 계약의 새 billingDate
      const contract = {
        id: 'contract_second',
        userId,
        planId: 'plan_001',
        billingDate: secondBillingDate,
        lastPaymentIntentId: 'intent_second',
        autoRenewal: false,
        status: 'ACTIVE',
        createdAt: new Date(),
      };
      const plan = {
        id: 'plan_001',
        tierId: 'tier_001',
        price: 10000,
        trialDays: 0,
        durationDays: 30,
      };

      mockEntitlementService.checkAndUpdateSubscription.mockResolvedValue(true);
      mockContractReader.findContractWithPlan.mockResolvedValue({ contract, plan });
      // 두번째 멤버십 현재 주기엔 사용 이력 없음 (과거 웰컴딜은 다른 주기라 여기 안 잡힘)
      mockBenefitReader.findCurrentCycleBenefit.mockResolvedValue({
        orderCount: 0,
        totalDiscountAmount: 0,
      });
      mockCancellationManager.cancelImmediately.mockResolvedValue({
        type: 'IMMEDIATE_CANCELLATION',
        contractId: 'contract_second',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: true,
        refundAmount: 10000,
        refundStatus: 'PENDING',
        message: '',
      });

      // When
      const result = await service.cancelSubscription(userId, email, 'NO_LONGER_NEEDED');

      // Then
      expect(result.type).toBe('IMMEDIATE_CANCELLATION');
      // 혜택 조회는 현재(두번째) 계약의 billingDate 로만 이뤄져야 한다 (lifetime 조회가 아님)
      expect(mockBenefitReader.findCurrentCycleBenefit).toHaveBeenCalledWith(
        userId,
        new Date(secondBillingDate),
        'MONTHLY',
      );
      // 전액 환불이 두번째 멤버십의 intent 로 실행되어야 한다
      expect(mockPaymentClientService.refundByIntent).toHaveBeenCalledWith(
        'intent_second',
        10000,
        'NO_LONGER_NEEDED',
        undefined,
        undefined,
      );
    });
  });
});
