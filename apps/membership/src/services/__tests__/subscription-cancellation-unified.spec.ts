import { Test, TestingModule } from '@nestjs/testing';
import { addDays, format } from 'date-fns';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import { SubscriptionCancellationService } from '../subscription-cancellation.service';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { SubscriptionCancellationManager } from '../subscription/subscription-cancellation.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { CancellationReasonReader } from '../subscription/cancellation-reason.reader';
import { PaymentClientService } from '../billing/payment-client.service';
import { BenefitReader } from '../benefit/benefit.reader';
import { PauseReader } from '../pause/pause.reader';
import { PauseManager } from '../pause/pause.manager';
import { InvoiceBillingManager } from '../billing/invoice-billing.manager';
import { CancellationContextReader } from '../subscription/cancellation-context.reader';
import { RefundPolicyService } from '../subscription/refund-policy.service';

/**
 * 정책 (2026-07 확정)
 * - 월간: 이용 시작 후 환불 불가. 예외는 결제 후 7일 내 + 혜택 미사용(청약철회) 전액 환불뿐.
 * - 연간: 사용 개월을 월간 정가로 차감해 정산 (10개월 경과 후 0원).
 * - 해지 방식(즉시해지/해지예약)은 **고객이 고른다** — 서버가 강제 분기하지 않는다.
 */
describe('SubscriptionCancellationService', () => {
  let service: SubscriptionCancellationService;

  const MONTHLY_PLAN = { id: 'plan_monthly', tierId: 'tier_001', price: 4990, trialDays: 0, durationDays: 30 };
  const ANNUAL_PLAN = { id: 'plan_annual', tierId: 'tier_001', price: 49900, trialDays: 0, durationDays: 365 };

  const mockContractReader = {
    findContractWithPlan: jest.fn(),
    findContractsByUserId: jest.fn(),
    findById: jest.fn(),
    findPlan: jest.fn(),
    findCurrentEntitlement: jest.fn(),
    findMonthlyListPrice: jest.fn().mockResolvedValue(4990),
    // 해지 시점에 정기결제였는지 — 해지 철회(자동결제 재개)를 열어줄지 판단하는 값.
    wasRecurringBeforeCancellation: jest.fn().mockResolvedValue(true),
    // 가입/해지 시점의 사실로 '되살릴 자동결제가 있는지'를 판정한다(1회 결제면 false).
    canResumeRecurring: jest.fn().mockResolvedValue(true),
    // 결제 기록이 없는 계약을 가정 — 주기 시작은 endsAt 역산 폴백으로 계산된다.
    findLastChargeSuccessAt: jest.fn().mockResolvedValue(null),
  };

  const mockCancellationManager = {
    cancelImmediately: jest.fn(),
    forceCancelSubscription: jest.fn(),
    cancelRecurringPayment: jest.fn(),
    undoRecurringCancellation: jest.fn(),
    recordRefundOutcome: jest.fn().mockResolvedValue(undefined),
    markAgreementRevokePending: jest.fn().mockResolvedValue(undefined),
  };

  const mockPaymentClientService = {
    getRefundability: jest.fn(),
    refundByIntent: jest.fn(),
    revokeBillingAgreement: jest.fn().mockResolvedValue(undefined),
    terminateBillingMandate: jest.fn(),
    createBillingAgreement: jest.fn().mockResolvedValue(undefined),
  };

  // 일시정지 이력이 없는 일반 계약이 기본값 — 정지 보정은 정책 스펙에서 따로 다룬다.
  const mockPauseReader = {
    sumPausedDaysSince: jest.fn().mockResolvedValue(0),
    // 기본은 정지 아님 — 정지 중 해지는 통합 스펙에서 실제 자격 전이까지 검증한다.
    findPausedEntitlement: jest.fn().mockResolvedValue(null),
  };
  const mockPauseManager = { resumePause: jest.fn().mockResolvedValue(undefined) };

  const mockBenefitReader = {
    findBenefitUsageBetween: jest.fn(),
    sumBenefitDiscountSince: jest.fn().mockResolvedValue(0),
  };

  const mockEventPublisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };

  /** 결제 주기가 daysAgo 일 전에 시작된 활성 계약 상황을 만든다. */
  function givenActiveContract(params: {
    plan: typeof MONTHLY_PLAN;
    daysSincePeriodStart: number;
    autoRenewal?: boolean;
    recurringCancelledAt?: Date | null;
    lastPaymentIntentId?: string | null;
  }) {
    const periodEndsAt = addDays(new Date(), params.plan.durationDays - params.daysSincePeriodStart);
    const contract = {
      id: 'contract_001',
      userId: 'user_001',
      planId: params.plan.id,
      billingDate: format(addDays(new Date(), -params.daysSincePeriodStart), 'yyyy-MM-dd'),
      nextBillingDate: format(periodEndsAt, 'yyyy-MM-dd'),
      lastPaymentIntentId: params.lastPaymentIntentId === undefined ? 'intent_001' : params.lastPaymentIntentId,
      autoRenewal: params.autoRenewal ?? true,
      recurringCancelledAt: params.recurringCancelledAt ?? null,
      status: 'ACTIVE',
      billingPath: 'CHARGE',
      eligibleRefundAmount: 0,
      createdAt: new Date(),
    };

    mockContractReader.findContractWithPlan.mockResolvedValue({ contract, plan: params.plan });
    mockContractReader.findById.mockResolvedValue(contract);
    mockContractReader.findPlan.mockResolvedValue(params.plan);
    mockContractReader.findCurrentEntitlement.mockResolvedValue({
      id: 'ent_001',
      startsAt: format(addDays(new Date(), -params.daysSincePeriodStart), 'yyyy-MM-dd'),
      endsAt: format(periodEndsAt, 'yyyy-MM-dd'),
    });

    return { contract, periodEndsAt };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockContractReader.findMonthlyListPrice.mockResolvedValue(4990);
    mockBenefitReader.findBenefitUsageBetween.mockResolvedValue({ orderCount: 0, totalDiscountAmount: 0 });
    mockBenefitReader.sumBenefitDiscountSince.mockResolvedValue(0);
    mockPauseReader.sumPausedDaysSince.mockResolvedValue(0);
    mockPauseReader.findPausedEntitlement.mockResolvedValue(null);
    // 기본은 카드/무통장처럼 PG 자동환불이 되는 수단
    mockPaymentClientService.getRefundability.mockResolvedValue({
      intentId: 'intent_001',
      refundableAmount: 49900,
      alreadyRefundedAmount: 0,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      methodTypes: ['TOSS'],
    });
    mockPaymentClientService.refundByIntent.mockResolvedValue({ status: 'SUCCEEDED', refundedAmount: 4990 });
    mockPaymentClientService.terminateBillingMandate.mockResolvedValue({
      agreementFound: true,
      cancelledWithdrawals: 0,
      mandateTerminated: true,
    });
    mockCancellationManager.cancelImmediately.mockImplementation(async (_u, c, _p, _rc, _rt, eligibility) => ({
      type: 'IMMEDIATE_CANCELLATION',
      contractId: c.id,
      status: 'CANCELLED',
      cancelledAt: new Date(),
      refundEligible: eligibility.eligible,
      refundAmount: eligibility.amount,
      refundStatus: eligibility.eligible ? 'PENDING' : 'NOT_APPLICABLE',
      message: '',
    }));
    mockCancellationManager.cancelRecurringPayment.mockImplementation(async (_u, c) => ({
      type: 'RECURRING_CANCELLATION',
      contractId: c.id,
      status: 'RECURRING_CANCELLED',
      recurringCancelledAt: new Date(),
      nextBillingDate: null,
      currentPeriodEndsAt: '2026-12-31',
      autoRenewal: false,
      refundEligible: false,
      message: '',
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCancellationService,
        // 정책·컨텍스트는 실물을 쓴다 — 미리보기와 실행이 같은 판단을 하는지가 핵심이라서.
        RefundPolicyService,
        CancellationContextReader,
        { provide: SubscriptionContractReader, useValue: mockContractReader },
        { provide: SubscriptionCancellationManager, useValue: mockCancellationManager },
        { provide: MembershipEventPublisher, useValue: mockEventPublisher },
        { provide: CancellationReasonReader, useValue: { findActiveReasons: jest.fn() } },
        { provide: PaymentClientService, useValue: mockPaymentClientService },
        { provide: BenefitReader, useValue: mockBenefitReader },
        { provide: PauseReader, useValue: mockPauseReader },
        { provide: PauseManager, useValue: mockPauseManager },
        { provide: InvoiceBillingManager, useValue: { voidInvoicesForContract: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(SubscriptionCancellationService);
  });

  describe('cancelSubscription', () => {
    it('활성 구독이 없으면 NotFoundError', async () => {
      mockContractReader.findContractWithPlan.mockResolvedValue(null);
      mockContractReader.findContractsByUserId.mockResolvedValue([]);

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', { reasonCode: 'NO_LONGER_NEEDED' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('이미 해지된 구독이면 ConflictError', async () => {
      mockContractReader.findContractWithPlan.mockResolvedValue(null);
      mockContractReader.findContractsByUserId.mockResolvedValue([{ status: 'CANCELLED' }]);

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', { reasonCode: 'NO_LONGER_NEEDED' }),
      ).rejects.toThrow(ConflictError);
    });

    it('결제 7일 내 + 혜택 미사용이면 즉시해지로 전액 환불', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 2 });

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'IMMEDIATE_REFUND',
      });

      expect(result.type).toBe('IMMEDIATE_CANCELLATION');
      expect(mockPaymentClientService.refundByIntent).toHaveBeenCalledWith(
        'intent_001',
        MONTHLY_PLAN.price,
        'NO_LONGER_NEEDED',
        undefined,
        undefined,
      );
    });

    it('환불 자격이 있어도 고객이 해지예약을 고르면 잔여기간을 유지하고 환불하지 않는다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 2 });

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'AT_PERIOD_END',
      });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(mockPaymentClientService.refundByIntent).not.toHaveBeenCalled();
    });

    it('월간에서 7일이 지나면 즉시해지(환불)를 요청해도 거부한다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 20 });

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', {
          reasonCode: 'NO_LONGER_NEEDED',
          cancelType: 'IMMEDIATE_REFUND',
        }),
      ).rejects.toThrow(BadRequestError);
      expect(mockPaymentClientService.refundByIntent).not.toHaveBeenCalled();
    });

    it('7일 내라도 이번 주기에 혜택을 썼으면 환불 불가', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 3 });
      mockBenefitReader.findBenefitUsageBetween.mockResolvedValue({ orderCount: 1, totalDiscountAmount: 3000 });

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', {
          reasonCode: 'NO_LONGER_NEEDED',
          cancelType: 'IMMEDIATE_REFUND',
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it('연간 3개월 사용 후 해지는 월간 정가로 차감해 34,930원 환불', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 75, autoRenewal: false });

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'IMMEDIATE_REFUND',
      });

      // 결과가 판별 유니온이 됐다. refundAmount 는 즉시취소 쪽에만 있으므로 먼저 좁힌다.
      if (result.type !== 'IMMEDIATE_CANCELLATION') {
        throw new Error(`즉시환불 취소를 요청했는데 결과가 ${result.type} 이다`);
      }
      expect(result.refundAmount).toBe(49900 - 3 * 4990);
      expect(mockPaymentClientService.refundByIntent).toHaveBeenCalledWith(
        'intent_001',
        34930,
        'NO_LONGER_NEEDED',
        undefined,
        undefined,
      );
    });

    it('연간 10개월 경과 후에는 환불액이 0이라 즉시해지를 막는다(잔여기간 이용 유도)', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 310, autoRenewal: false });

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', {
          reasonCode: 'NO_LONGER_NEEDED',
          cancelType: 'IMMEDIATE_REFUND',
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it('자동이체(CMS)처럼 PG 환불이 불가한 수단은 wallet 을 호출하지 않고 수동 송금 대기로 남긴다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 1 });
      mockPaymentClientService.getRefundability.mockResolvedValue({
        intentId: 'intent_001',
        refundableAmount: 4990,
        alreadyRefundedAmount: 0,
        autoRefundSupported: false,
        requiresReceiveAccount: false,
        methodTypes: ['CMS_BATCH'],
      });

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'IMMEDIATE_REFUND',
        refundReceiveAccount: { bank: '20', accountNumber: '1234', holderName: '홍길동' },
      });

      expect(mockPaymentClientService.refundByIntent).not.toHaveBeenCalled();
      expect((result as { refundStatus: string }).refundStatus).toBe('PENDING');
      expect(mockCancellationManager.recordRefundOutcome).toHaveBeenCalledWith(
        'contract_001',
        'user_001',
        4990,
        expect.objectContaining({ status: 'PENDING', errorCode: 'MANUAL_TRANSFER_REQUIRED' }),
      );
    });

    it('수동 송금이 필요한데 계좌가 없으면 거부한다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 1 });
      mockPaymentClientService.getRefundability.mockResolvedValue({
        intentId: 'intent_001',
        refundableAmount: 4990,
        alreadyRefundedAmount: 0,
        autoRefundSupported: false,
        requiresReceiveAccount: true,
        methodTypes: ['CMS_BATCH'],
      });

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', {
          reasonCode: 'NO_LONGER_NEEDED',
          cancelType: 'IMMEDIATE_REFUND',
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it('wallet 환불이 실패하면 성공으로 위장하지 않고 FAILED 로 보고한다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 1 });
      mockPaymentClientService.refundByIntent.mockResolvedValue({
        status: 'FAILED',
        refundedAmount: 0,
        errorCode: 'CMS_REFUND_NOT_SUPPORTED',
      });

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'IMMEDIATE_REFUND',
      });

      expect((result as { refundStatus: string }).refundStatus).toBe('FAILED');
    });

    it('이미 해지 예약된 구독에 다시 해지예약을 요청하면 ConflictError', async () => {
      givenActiveContract({
        plan: MONTHLY_PLAN,
        daysSincePeriodStart: 20,
        autoRenewal: false,
        recurringCancelledAt: new Date(),
      });

      await expect(
        service.cancelSubscription('user_001', 'a@b.com', {
          reasonCode: 'NO_LONGER_NEEDED',
          cancelType: 'AT_PERIOD_END',
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('해지 시 효성 자동이체 약정을 종료한다 (약정해지 API 가 없어 회원삭제가 유일한 수단)', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 20 });

      await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'AT_PERIOD_END',
      });

      expect(mockPaymentClientService.terminateBillingMandate).toHaveBeenCalledWith('contract_001', false);
      expect(mockCancellationManager.markAgreementRevokePending).not.toHaveBeenCalled();
    });

    it('결제수단이 다른 활성 구독과 공유되면 약정을 지우지 않고, 재정리 대상으로도 남기지 않는다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 20 });
      mockPaymentClientService.terminateBillingMandate.mockResolvedValue({
        agreementFound: true,
        cancelledWithdrawals: 0,
        mandateTerminated: false,
        skipReason: 'BILLING_METHOD_IN_USE_BY_OTHER_AGREEMENT',
      });

      await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'AT_PERIOD_END',
      });

      expect(mockCancellationManager.markAgreementRevokePending).not.toHaveBeenCalled();
    });

    it('약정 종료(wallet) 실패는 해지를 되돌리지 않고 후속 정리 대상으로 남긴다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 20 });
      mockPaymentClientService.terminateBillingMandate.mockRejectedValue(new Error('wallet down'));

      const result = await service.cancelSubscription('user_001', 'a@b.com', {
        reasonCode: 'NO_LONGER_NEEDED',
        cancelType: 'AT_PERIOD_END',
      });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(mockCancellationManager.markAgreementRevokePending).toHaveBeenCalledWith('contract_001', 'user_001');
    });
  });

  describe('forceCancelSubscription — 관리자 환불 금액 상한', () => {
    it('정책 산정액 이내면 초과 권한 없이도 환불한다', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 75, autoRenewal: false });
      mockCancellationManager.forceCancelSubscription.mockResolvedValue({
        contractId: 'contract_001',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: true,
        refundAmount: 30000,
        refundStatus: 'PENDING',
      });

      const result = await service.forceCancelSubscription(
        'contract_001',
        'admin_1',
        '고객 요청',
        'PARTIAL',
        30000,
        undefined,
        undefined,
        false,
      );

      expect(result.refundStatus).toBe('COMPLETED');
    });

    it('정책 산정액을 초과하면 초과 권한 없이는 거부한다 (연간 전액 환불 방지)', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 75, autoRenewal: false });

      await expect(
        service.forceCancelSubscription('contract_001', 'admin_1', '고객 요청', 'FULL', undefined, undefined, undefined, false),
      ).rejects.toThrow(ForbiddenError);
      expect(mockCancellationManager.forceCancelSubscription).not.toHaveBeenCalled();
    });

    it('초과 권한이 있으면 정책을 넘겨 환불할 수 있다 (장애 보상 등 예외)', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 75, autoRenewal: false });
      mockCancellationManager.forceCancelSubscription.mockResolvedValue({
        contractId: 'contract_001',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: true,
        refundAmount: 49900,
        refundStatus: 'PENDING',
      });

      const result = await service.forceCancelSubscription(
        'contract_001',
        'admin_1',
        '서비스 장애 보상',
        'FULL',
        undefined,
        undefined,
        undefined,
        true,
      );

      expect(result.refundAmount).toBe(49900);
    });

    it('환불 없는 강제 취소는 상한 검사를 하지 않는다', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 310, autoRenewal: false });
      mockCancellationManager.forceCancelSubscription.mockResolvedValue({
        contractId: 'contract_001',
        status: 'CANCELLED',
        cancelledAt: new Date(),
        refundEligible: false,
        refundAmount: 0,
        refundStatus: 'NOT_APPLICABLE',
      });

      const result = await service.forceCancelSubscription(
        'contract_001',
        'admin_1',
        '중복 가입 정리',
        'NONE',
        undefined,
        undefined,
        undefined,
        false,
      );

      expect(result.refundStatus).toBe('NOT_APPLICABLE');
    });
  });

  describe('previewCancellation', () => {
    it('선택지와 환불 금액을 실제 해지와 동일한 정책으로 계산한다', async () => {
      givenActiveContract({ plan: ANNUAL_PLAN, daysSincePeriodStart: 75, autoRenewal: false });

      const preview = await service.previewCancellation('user_001');
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND');

      expect(immediate?.available).toBe(true);
      expect(immediate?.refundAmount).toBe(34930);
      expect(immediate?.breakdown).toEqual({
        paidAmount: 49900,
        monthlyListPrice: 4990,
        monthsElapsed: 3,
        usageDeduction: 14970,
        benefitDeduction: 0,
      });
      expect(preview.recommendedMode).toBe('IMMEDIATE_REFUND');
    });

    it('환불이 불가한 월간 구독은 해지예약을 권장한다', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 20 });

      const preview = await service.previewCancellation('user_001');

      expect(preview.recommendedMode).toBe('AT_PERIOD_END');
      expect(preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')?.available).toBe(false);
    });
  });

  describe('undoCancellation', () => {
    it('해지 예약이 아니면 ConflictError', async () => {
      givenActiveContract({ plan: MONTHLY_PLAN, daysSincePeriodStart: 5 });

      await expect(service.undoCancellation('user_001', 'a@b.com')).rejects.toThrow(ConflictError);
    });

    it('약정을 먼저 복구한 뒤 자동갱신을 되살린다', async () => {
      const { periodEndsAt } = givenActiveContract({
        plan: MONTHLY_PLAN,
        daysSincePeriodStart: 5,
        autoRenewal: false,
        recurringCancelledAt: new Date(),
      });
      mockCancellationManager.undoRecurringCancellation.mockResolvedValue({
        type: 'CANCELLATION_UNDONE',
        contractId: 'contract_001',
        status: 'ACTIVE',
        autoRenewal: true,
        nextBillingDate: format(periodEndsAt, 'yyyy-MM-dd'),
        message: '',
      });

      const result = await service.undoCancellation('user_001', 'a@b.com');

      expect(mockPaymentClientService.createBillingAgreement).toHaveBeenCalledWith('user_001', 'contract_001');
      expect(result.type).toBe('CANCELLATION_UNDONE');
    });

    it('1회 결제 계약의 철회는 거부한다 (동의 없는 정기결제 전환 방지)', async () => {
      givenActiveContract({
        plan: MONTHLY_PLAN,
        daysSincePeriodStart: 5,
        autoRenewal: false,
        recurringCancelledAt: new Date(),
      });
      mockContractReader.canResumeRecurring.mockResolvedValueOnce(false);

      await expect(service.undoCancellation('user_001', 'a@b.com')).rejects.toThrow(ConflictError);
      expect(mockPaymentClientService.createBillingAgreement).not.toHaveBeenCalled();
    });

    it('약정 복구가 실패하면 상태를 되살리지 않는다', async () => {
      givenActiveContract({
        plan: MONTHLY_PLAN,
        daysSincePeriodStart: 5,
        autoRenewal: false,
        recurringCancelledAt: new Date(),
      });
      mockPaymentClientService.createBillingAgreement.mockRejectedValue(new Error('no billing method'));

      await expect(service.undoCancellation('user_001', 'a@b.com')).rejects.toThrow('no billing method');
      expect(mockCancellationManager.undoRecurringCancellation).not.toHaveBeenCalled();
    });
  });
});
