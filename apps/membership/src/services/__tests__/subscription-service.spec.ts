import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService } from '../subscription.service';
import { EntitlementService } from '../entitlement.service';
import { PlanService } from '../plan.service';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { SubscriptionCreator } from '../subscription/subscription.creator';
import { SubscriptionManager } from '../subscription/subscription.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { PaymentClientService } from '../billing/payment-client.service';
import { BillingManager } from '../billing/billing.manager';
import { BillingReader } from '../billing/billing.reader';
import { InvoiceBillingManager } from '../billing/invoice-billing.manager';
import { ConfigService } from '@nestjs/config';
import { SavingsService } from '../savings/savings.service';

describe('SubscriptionService - Layer Refactoring', () => {
  let service: SubscriptionService;

  const mockEntitlementService = {
    getUserEntitlement: jest.fn(),
  };

  const mockPlanService = {
    getPlanDetails: jest.fn(),
  };

  const mockContractReader = {
    findActiveContract: jest.fn(),
    findById: jest.fn(),
    findPlan: jest.fn(),
    findContractsByUserId: jest.fn(),
    findByPaymentIntentId: jest.fn(),
  };

  const mockSubscriptionCreator = {
    createNewSubscription: jest.fn(),
  };

  const mockSubscriptionManager = {
    upgradeSubscription: jest.fn(),
    voidSubscription: jest.fn(),
  };

  const mockMembershipEventPublisher = {
    publishStatusChanged: jest.fn().mockResolvedValue(undefined),
  };

  const mockPaymentClientService = {
    getRefundability: jest.fn(),
    createMembershipCheckoutIntent: jest.fn(),
    getWalletPaymentIntent: jest.fn(),
    directCharge: jest.fn(),
  };

  const mockBillingManager = {
    processSingleBilling: jest.fn(),
  };

  const mockBillingReader = {
    findContractById: jest.fn(),
    findDunningByContractId: jest.fn().mockResolvedValue(null),
  };

  const mockInvoiceBillingManager = {
    issueInvoiceForContract: jest.fn().mockResolvedValue({ success: true }),
    voidInvoicesForContract: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined),
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
        {
          provide: MembershipEventPublisher,
          useValue: mockMembershipEventPublisher,
        },
        {
          provide: PaymentClientService,
          useValue: mockPaymentClientService,
        },
        {
          provide: BillingManager,
          useValue: mockBillingManager,
        },
        {
          provide: BillingReader,
          useValue: mockBillingReader,
        },
        {
          provide: InvoiceBillingManager,
          useValue: mockInvoiceBillingManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: SavingsService,
          useValue: { getSavingsByContract: jest.fn().mockResolvedValue({}) },
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
      const email = 'test@example.com';

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
      const result = await service.createSubscription(userId, planId, email);

      // Then
      expect(result).toEqual({
        contractId: 'contract_001',
        entitlementId: 'entitlement_001',
      });
      expect(mockSubscriptionCreator.createNewSubscription).toHaveBeenCalledWith(
        userId,
        { id: planId, price: 10000, durationDays: 30 },
        { id: 'tier_001', code: 'PREMIUM' },
        {},
        'one_time',
        false,
        'CHARGE',
        email,
      );
      // one_time 은 createNewSubscription 내부에서 아웃박스로 원자 발행하므로
      // 서비스 레벨의 best-effort publishStatusChanged 는 호출되지 않는다.
      expect(mockMembershipEventPublisher.publishStatusChanged).not.toHaveBeenCalled();
    });

    it('기존 구독이 있으면 에러를 발생시켜야 함', async () => {
      // Given
      const userId = 'test_user_001';
      const planId = 'plan_001';
      const email = 'test@example.com';

      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        entitlement: { id: 'existing' },
      });

      // When & Then
      await expect(service.createSubscription(userId, planId, email)).rejects.toThrow();
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

      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        entitlement: { id: 'entitlement_001', startsAt: '2026-06-01', endsAt: '2026-07-01', pausedAt: null },
        contract: {
          id: 'contract_001',
          userId,
          planId: 'plan_001',
          status: 'ACTIVE',
          autoRenewal: true,
          billingDate: null,
          nextBillingDate: '2026-07-01',
          recurringCancelledAt: null,
        },
        plan: { id: 'plan_001', tierId: 'tier_001', price: 10000, currency: 'KRW', durationDays: 30, trialDays: 0, isActive: true },
        tier: { id: 'tier_001', code: 'GOLD', name: 'Gold', priorityLevel: 1 },
      });

      // When
      const result = await service.getCurrentSubscriptionDetails(userId);

      // Then: 평탄한 형태로 톱레벨 status/autoRenewal 이 노출된다
      expect(result).toMatchObject({
        id: 'contract_001',
        status: 'ACTIVE',
        autoRenewal: true,
        endDate: '2026-07-01',
        paymentActionNeeded: false,
      });
      expect(result?.tier).toMatchObject({ code: 'GOLD' });
    });

    it('dunning 항목이 있으면 paymentActionNeeded=true, 내부값은 노출 안 함', async () => {
      mockEntitlementService.getUserEntitlement.mockResolvedValue({
        entitlement: { id: 'e1', startsAt: '2026-06-01', endsAt: '2026-07-01', pausedAt: null },
        contract: { id: 'c1', userId: 'u1', planId: 'p1', status: 'ACTIVE', autoRenewal: true, billingDate: null, nextBillingDate: '2026-07-01', recurringCancelledAt: null },
        plan: { id: 'p1', tierId: 't1', price: 10000, currency: 'KRW', durationDays: 30, trialDays: 0, isActive: true },
        tier: { id: 't1', code: 'GOLD', priorityLevel: 1 },
      });
      mockBillingReader.findDunningByContractId.mockResolvedValueOnce({
        attempts: 2,
        maxAttempts: 3,
        nextRetryAt: new Date('2026-07-05T00:00:00Z'),
        lastErrorCode: 'INSUFFICIENT_FUNDS',
        lastErrorMessage: '잔액 부족',
      });

      const result = await service.getCurrentSubscriptionDetails('u1');

      expect(result?.paymentActionNeeded).toBe(true);
      // 더닝 내부값은 고객 응답에 노출되지 않는다
      expect(result).not.toHaveProperty('attempts');
      expect(result).not.toHaveProperty('nextRetryAt');
      expect(result).not.toHaveProperty('lastErrorCode');
    });
  });

  describe('adminCreateSubscription', () => {
    it('recurring 은 결제수단/약정 없이 완결 불가라 거부한다', async () => {
      await expect(service.adminCreateSubscription('u1', 'plan_001', 'recurring')).rejects.toThrow();
      // 계약을 만들지 않아야 한다
      expect(mockSubscriptionCreator.createNewSubscription).not.toHaveBeenCalled();
    });

    it('one_time 은 계약을 생성한다', async () => {
      mockEntitlementService.getUserEntitlement.mockResolvedValue(null);
      mockPlanService.getPlanDetails.mockResolvedValue({
        plan: { id: 'plan_001', price: 10000, durationDays: 30, isActive: true },
        tier: { id: 'tier_001', code: 'GOLD' },
      });
      mockSubscriptionCreator.createNewSubscription.mockResolvedValue({ contractId: 'c1' });

      const result = await service.adminCreateSubscription('u1', 'plan_001', 'one_time');

      expect(result).toEqual({ contractId: 'c1' });
      expect(mockSubscriptionCreator.createNewSubscription).toHaveBeenCalled();
    });
  });

  describe('voidByPaymentIntent', () => {
    const activeContract = { id: 'c1', userId: 'u1', status: 'ACTIVE', planId: 'p1' };

    /** wallet 이 보는 이 결제의 환불 규모. 전액이면 자격 회수, 부분이면 유지가 맞다. */
    const givenWalletRefunded = (refundable: number, alreadyRefunded: number) =>
      mockPaymentClientService.getRefundability.mockResolvedValue({
        intentId: 'intent_1',
        refundableAmount: refundable,
        alreadyRefundedAmount: alreadyRefunded,
      });

    it('전액 환불이면 intent 로 만든 ACTIVE 구독을 무효화한다', async () => {
      mockContractReader.findByPaymentIntentId.mockResolvedValue(activeContract);
      givenWalletRefunded(4990, 4990);

      await service.voidByPaymentIntent('intent_1', '결제 환불', 4990);

      expect(mockSubscriptionManager.voidSubscription).toHaveBeenCalledWith('u1', activeContract, '결제 환불');
    });

    // 결제관리에서 배송 지연 사과 같은 소액 보상을 멤버십 결제에 걸면, 예전에는 그 환불 이벤트만으로
    // 멤버십이 통째로 취소됐다 — 돈은 조금 돌려주고 남은 이용권을 전부 뺏는 결과다.
    it('부분 환불이면 구독을 유지한다 (소액 보상이 멤버십을 취소하지 않는다)', async () => {
      mockContractReader.findByPaymentIntentId.mockResolvedValue(activeContract);
      givenWalletRefunded(49900, 1000);

      await service.voidByPaymentIntent('intent_1', '결제 환불', 1000);

      expect(mockSubscriptionManager.voidSubscription).not.toHaveBeenCalled();
    });

    it('wallet 조회가 실패하면 이벤트 금액과 플랜 가격으로 판단한다', async () => {
      mockContractReader.findByPaymentIntentId.mockResolvedValue(activeContract);
      mockContractReader.findById.mockResolvedValue(activeContract);
      mockPaymentClientService.getRefundability.mockRejectedValue(new Error('wallet down'));
      mockPlanService.getPlanDetails.mockResolvedValue({ plan: { price: 4990 } });

      await service.voidByPaymentIntent('intent_1', '결제 환불', 1000);
      expect(mockSubscriptionManager.voidSubscription).not.toHaveBeenCalled();

      await service.voidByPaymentIntent('intent_1', '결제 환불', 4990);
      expect(mockSubscriptionManager.voidSubscription).toHaveBeenCalled();
    });

    it('해당 intent 의 구독이 없으면 아무것도 하지 않는다', async () => {
      mockContractReader.findByPaymentIntentId.mockResolvedValue(null);

      await service.voidByPaymentIntent('intent_1', '결제 환불');

      expect(mockSubscriptionManager.voidSubscription).not.toHaveBeenCalled();
    });

    it('이미 CANCELLED 면 멱등하게 스킵한다 (취소→환불 경로 중복 방지)', async () => {
      mockContractReader.findByPaymentIntentId.mockResolvedValue({ id: 'c1', userId: 'u1', status: 'CANCELLED' });

      await service.voidByPaymentIntent('intent_1', '결제 환불');

      expect(mockSubscriptionManager.voidSubscription).not.toHaveBeenCalled();
    });
  });
});
