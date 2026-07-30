/**
 * 멤버십 해지·환불 E2E (실제 DB).
 *
 * 고객·관리자가 실제로 취할 수 있는 모든 경로를 실 DB 트랜잭션으로 검증한다. 외부 경계(wallet HTTP,
 * Kafka)만 대역으로 두고, 계약/자격/이벤트/더닝 상태 전이와 재청구 차단은 모두 실제 쿼리로 확인한다.
 *
 * 실행: npm run test:membership:cancellation-e2e
 *   (전용 임시 Postgres 를 띄워 마이그레이션을 적용한 뒤 돌린다)
 *
 * 이 스펙은 테이블을 전부 비우므로 **공유 dev/live DB 에서 절대 실행되면 안 된다.** 그래서 기본
 * `jest` 실행에서는 건너뛰고, 스크립트가 넘겨주는 MEMBERSHIP_CANCELLATION_E2E=1 일 때만 동작한다.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { addDays, format, subDays } from 'date-fns';
import { and, eq } from 'drizzle-orm';
import { DbModule, DbService } from '@app/db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@app/shared';
import * as schema from '../../src/shared/schemas/entities/schema';
import { membershipSchema } from '../../src/shared/schemas/entities/schema';
import { SubscriptionCancellationService } from '../../src/services/subscription-cancellation.service';
import { SubscriptionCancellationManager } from '../../src/services/subscription/subscription-cancellation.manager';
import { SubscriptionContractReader } from '../../src/services/subscription/subscription-contract.reader';
import { CancellationContextReader } from '../../src/services/subscription/cancellation-context.reader';
import { RefundPolicyService } from '../../src/services/subscription/refund-policy.service';
import { CancellationReasonReader } from '../../src/services/subscription/cancellation-reason.reader';
import { ContractEventManager } from '../../src/services/subscription/contract-event.manager';
import { BenefitReader } from '../../src/services/benefit/benefit.reader';
import { BillingReader } from '../../src/services/billing/billing.reader';
import { PaymentClientService } from '../../src/services/billing/payment-client.service';
import { MembershipEventPublisher } from '../../src/services/membership-event.publisher';
import { InvoiceBillingManager } from '../../src/services/billing/invoice-billing.manager';
import { AdminMembersReader } from '../../src/services/admin/admin-members.reader';
import { RefundEventHandler } from '../../src/services/refund-event-handler.service';

type MembershipSchema = typeof membershipSchema;

const MONTHLY_PRICE = 4990;
const ANNUAL_PRICE = 49900;
const EMAIL = 'e2e@example.com';

// 전용 DB 를 준 실행에서만 동작한다(공유 DB 오염 방지).
const isDedicatedRun = process.env.MEMBERSHIP_CANCELLATION_E2E === '1' && !!process.env.DATABASE_URL;
const describeE2E = isDedicatedRun ? describe : describe.skip;

describeE2E('멤버십 해지·환불 E2E', () => {
  let module: TestingModule;
  let db: DbService<MembershipSchema>;
  let service: SubscriptionCancellationService;
  let billingReader: BillingReader;
  let adminReader: AdminMembersReader;
  let refundEventHandler: RefundEventHandler;

  let tierId: string;
  let monthlyPlanId: string;
  let annualPlanId: string;

  // 외부 경계 대역 — 호출 여부/인자를 검증한다.
  const wallet = {
    getRefundability: jest.fn(),
    refundByIntent: jest.fn(),
    terminateBillingMandate: jest.fn(),
    revokeBillingAgreement: jest.fn(),
    createBillingAgreement: jest.fn(),
  };
  const events = { publishStatusChanged: jest.fn(), saveStatusChanged: jest.fn() };
  const invoices = { voidInvoicesForContract: jest.fn(), issueInvoiceForContract: jest.fn() };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 이 필요합니다 (전용 e2e DB).');

    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: { connectionString: process.env.DATABASE_URL },
          schema: membershipSchema,
        }),
      ],
      providers: [
        SubscriptionCancellationService,
        SubscriptionCancellationManager,
        SubscriptionContractReader,
        CancellationContextReader,
        RefundPolicyService,
        CancellationReasonReader,
        ContractEventManager,
        BenefitReader,
        BillingReader,
        AdminMembersReader,
        RefundEventHandler,
        { provide: PaymentClientService, useValue: wallet },
        { provide: MembershipEventPublisher, useValue: events },
        { provide: InvoiceBillingManager, useValue: invoices },
      ],
    }).compile();

    db = module.get<DbService<MembershipSchema>>(DbService);
    service = module.get(SubscriptionCancellationService);
    billingReader = module.get(BillingReader);
    adminReader = module.get(AdminMembersReader);
    refundEventHandler = module.get(RefundEventHandler);

    await wipe();
    const [tier] = await db.db.insert(schema.tiers).values({ code: 'MEMBERSHIP', priorityLevel: 1 }).returning();
    tierId = tier.id;
    const [monthly] = await db.db
      .insert(schema.plan)
      .values({ tierId, price: MONTHLY_PRICE, durationDays: 30, trialDays: 0, isActive: true })
      .returning();
    monthlyPlanId = monthly.id;
    const [annual] = await db.db
      .insert(schema.plan)
      .values({ tierId, price: ANNUAL_PRICE, durationDays: 365, trialDays: 0, isActive: true })
      .returning();
    annualPlanId = annual.id;

    await db.db.insert(schema.cancellationReasons).values([
      { code: 'NOT_USING', displayText: '이용하지 않아요', category: 'GENERAL', sortOrder: 1, isActive: true },
      { code: 'EXPENSIVE', displayText: '비싸요', category: 'PRICE', sortOrder: 2, isActive: true },
    ]);
  }, 60000);

  afterAll(async () => {
    await wipe();
    await db.db.delete(schema.cancellationReasons);
    await db.db.delete(schema.plan);
    await db.db.delete(schema.tiers);
    await module.close();
  }, 30000);

  beforeEach(async () => {
    jest.clearAllMocks();
    // 기본: 카드 결제(PG 자동환불 가능), 환불 성공, 약정 종료 성공
    wallet.getRefundability.mockResolvedValue({
      intentId: 'intent_1',
      refundableAmount: ANNUAL_PRICE,
      alreadyRefundedAmount: 0,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      methodTypes: ['TOSS'],
    });
    wallet.refundByIntent.mockImplementation(async (_i: string, amount: number) => ({
      status: 'SUCCEEDED',
      refundedAmount: amount,
    }));
    wallet.terminateBillingMandate.mockResolvedValue({
      agreementFound: true,
      cancelledWithdrawals: 0,
      mandateTerminated: true,
    });
    wallet.createBillingAgreement.mockResolvedValue(undefined);
    events.publishStatusChanged.mockResolvedValue(undefined);
    invoices.voidInvoicesForContract.mockResolvedValue(undefined);
    await wipeContracts();
  });

  async function wipeContracts() {
    await db.db.delete(schema.membershipDunningQueue);
    await db.db.delete(schema.billingEvents);
    await db.db.delete(schema.subscriptionContractEvents);
    await db.db.delete(schema.subscriptionEntitlement);
    await db.db.delete(schema.subscriptionContracts);
    await db.db.delete(schema.eventBatches);
    await db.db.delete(schema.membershipDiscountEvents);
    await db.db.delete(schema.membershipCycleBenefits);
  }

  async function wipe() {
    await wipeContracts();
  }

  /** 결제 주기가 daysSincePeriodStart 일 전에 시작된 활성 구독을 만든다. */
  async function givenSubscription(params: {
    plan?: 'monthly' | 'annual';
    daysSincePeriodStart: number;
    recurring?: boolean;
    billingPath?: 'CHARGE' | 'INVOICE';
    hasPayment?: boolean;
    withDunning?: boolean;
  }) {
    const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
    const isAnnual = params.plan === 'annual';
    const planId = isAnnual ? annualPlanId : monthlyPlanId;
    const durationDays = isAnnual ? 365 : 30;
    const periodStart = subDays(new Date(), params.daysSincePeriodStart);
    const endsAt = addDays(periodStart, durationDays);
    const recurring = params.recurring ?? true;

    const [contract] = await db.db
      .insert(schema.subscriptionContracts)
      .values({
        userId,
        planId,
        billingDate: format(periodStart, 'yyyy-MM-dd'),
        nextBillingDate: recurring ? format(endsAt, 'yyyy-MM-dd') : null,
        autoRenewal: recurring,
        status: 'ACTIVE',
        billingPath: params.billingPath ?? 'CHARGE',
        lastPaymentIntentId: params.hasPayment === false ? null : 'intent_1',
      })
      .returning();

    await db.db.insert(schema.subscriptionEntitlement).values({
      userId,
      tierId,
      startsAt: format(periodStart, 'yyyy-MM-dd'),
      endsAt: format(endsAt, 'yyyy-MM-dd'),
      isCurrent: true,
    });

    if (params.withDunning) {
      await db.db.insert(schema.membershipDunningQueue).values({
        contractId: contract.id,
        nextRetryAt: new Date(),
        attempts: 1,
      });
    }

    return { userId, contract, endsAt: format(endsAt, 'yyyy-MM-dd'), periodStart };
  }

  /** 이번 집계 주기에 멤버십 할인 혜택을 사용한 이력을 만든다. */
  async function givenBenefitUsed(userId: string, contractId: string, cycleStart: Date) {
    await db.db.insert(schema.membershipCycleBenefits).values({
      userId,
      cycleStartDate: format(cycleStart, 'yyyy-MM-dd'),
      cycleEndDate: format(addDays(cycleStart, 29), 'yyyy-MM-dd'),
      totalDiscountAmount: 3000,
      orderCount: 1,
      subscriptionId: contractId,
      cycleNumber: 1,
    });
  }

  const loadContract = (id: string) =>
    db.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, id))
      .limit(1)
      .then((r) => r[0]);

  const loadCurrentEntitlement = (userId: string) =>
    db.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      )
      .limit(1)
      .then((r) => r[0]);

  const loadEventTypes = (contractId: string) =>
    db.db
      .select({ eventType: schema.subscriptionContractEvents.eventType })
      .from(schema.subscriptionContractEvents)
      .where(eq(schema.subscriptionContractEvents.contractId, contractId))
      .then((rows) => rows.map((r) => r.eventType));

  const countDunning = (contractId: string) =>
    db.db
      .select()
      .from(schema.membershipDunningQueue)
      .where(eq(schema.membershipDunningQueue.contractId, contractId))
      .then((r) => r.length);

  // ───────────────────────── 고객 시나리오 ─────────────────────────

  describe('고객 — 정기결제(월간)', () => {
    it('7일 내 무사용 즉시해지: 자격 회수 + 전액 환불 + 재청구 원천 차단', async () => {
      const { userId, contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 2, withDunning: true });

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
      });

      expect(result.type).toBe('IMMEDIATE_CANCELLATION');
      expect((result as { refundAmount: number }).refundAmount).toBe(MONTHLY_PRICE);
      expect((result as { refundStatus: string }).refundStatus).toBe('COMPLETED');

      const after = await loadContract(contract.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.cancelledAt).not.toBeNull();
      expect(after.autoRenewal).toBe(false);
      expect(after.nextBillingDate).toBeNull();
      expect(after.refundRequested).toBe(true);
      expect(after.eligibleRefundAmount).toBe(MONTHLY_PRICE);
      // 환불 성공이 계약에 기록돼야 한다(예전에는 영구히 false 였다)
      expect(after.refundCompleted).toBe(true);
      expect(after.refundCompletedAt).not.toBeNull();

      expect(await loadCurrentEntitlement(userId)).toBeUndefined();
      expect(await countDunning(contract.id)).toBe(0);
      expect(await loadEventTypes(contract.id)).toEqual(
        expect.arrayContaining(['CANCELLED', 'REFUND_REQUESTED', 'REFUND_COMPLETED']),
      );

      // 스케줄러가 이 계약을 다시 청구 대상으로 잡지 않아야 한다
      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      expect(due.map((d) => d.id)).not.toContain(contract.id);

      expect(wallet.refundByIntent).toHaveBeenCalledWith('intent_1', MONTHLY_PRICE, 'NOT_USING', undefined, undefined);
      expect(wallet.terminateBillingMandate).toHaveBeenCalledWith(contract.id);
      expect(events.publishStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CANCELLED', refundAmount: MONTHLY_PRICE, refundStatus: 'COMPLETED' }),
      );
      expect(endsAt).toBeDefined();
    });

    it('환불 자격이 있어도 해지예약을 고르면 잔여기간이 유지된다', async () => {
      const { userId, contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 2, withDunning: true });

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'AT_PERIOD_END',
      });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect((result as { currentPeriodEndsAt: string }).currentPeriodEndsAt).toBe(endsAt);

      const after = await loadContract(contract.id);
      expect(after.status).toBe('ACTIVE'); // 잔여기간 동안 회원 화면에 도달해야 한다
      expect(after.recurringCancelledAt).not.toBeNull();
      expect(after.recurringCancellationReasonCode).toBe('NOT_USING');
      expect(after.autoRenewal).toBe(false);
      expect(after.nextBillingDate).toBeNull();
      expect(after.refundRequested).toBe(false);

      // 자격은 종료일까지 유지
      const ent = await loadCurrentEntitlement(userId);
      expect(ent?.endsAt).toBe(endsAt);
      expect(await countDunning(contract.id)).toBe(0);
      expect(wallet.refundByIntent).not.toHaveBeenCalled();

      // 그러나 재청구는 되지 않는다
      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      expect(due.map((d) => d.id)).not.toContain(contract.id);
    });

    it('7일이 지나면 즉시해지(환불)를 거부하고 계약을 그대로 둔다', async () => {
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' }),
      ).rejects.toThrow(BadRequestError);

      const after = await loadContract(contract.id);
      expect(after.status).toBe('ACTIVE');
      expect(after.autoRenewal).toBe(true);
      expect(after.recurringCancelledAt).toBeNull();
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect(wallet.terminateBillingMandate).not.toHaveBeenCalled();
    });

    it('7일 내라도 혜택을 사용했으면 환불 불가', async () => {
      const { userId, contract, periodStart } = await givenSubscription({ daysSincePeriodStart: 3 });
      await givenBenefitUsed(userId, contract.id, periodStart);

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' }),
      ).rejects.toThrow(BadRequestError);

      // 해지예약은 가능해야 한다
      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'AT_PERIOD_END',
      });
      expect(result.type).toBe('RECURRING_CANCELLATION');
    });

    it('이미 해지 예약된 구독에 다시 해지예약하면 409', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 20 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' }),
      ).rejects.toThrow(ConflictError);
    });

    it('활성 구독이 없으면 404, 해지된 이력만 있으면 409', async () => {
      await expect(
        service.cancelSubscription('nobody', EMAIL, { reasonCode: 'NOT_USING' }),
      ).rejects.toThrow(NotFoundError);

      const { userId } = await givenSubscription({ daysSincePeriodStart: 1 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' });

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING' }),
      ).rejects.toThrow(ConflictError);
    });

    it('해지 방식을 지정하지 않으면 정책 권장값을 따른다', async () => {
      const withdrawal = await givenSubscription({ daysSincePeriodStart: 1 });
      const r1 = await service.cancelSubscription(withdrawal.userId, EMAIL, { reasonCode: 'NOT_USING' });
      expect(r1.type).toBe('IMMEDIATE_CANCELLATION'); // 환불 가능 → 즉시해지 권장

      const expired = await givenSubscription({ daysSincePeriodStart: 20 });
      const r2 = await service.cancelSubscription(expired.userId, EMAIL, { reasonCode: 'NOT_USING' });
      expect(r2.type).toBe('RECURRING_CANCELLATION'); // 환불 불가 → 해지예약 권장
    });
  });

  describe('고객 — 연간 1회 결제', () => {
    it.each([
      [75, 34930, 3],
      [180, 19960, 6],
      [270, 4990, 9],
    ])('경과 %i일이면 %i원 환불 (사용 %i개월 차감)', async (days, expectedRefund, months) => {
      const { userId, contract } = await givenSubscription({
        plan: 'annual',
        daysSincePeriodStart: days,
        recurring: false,
      });

      const preview = await service.previewCancellation(userId);
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.refundAmount).toBe(expectedRefund);
      expect(immediate.breakdown?.monthsElapsed).toBe(months);
      expect(immediate.breakdown?.monthlyListPrice).toBe(MONTHLY_PRICE);

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'EXPENSIVE',
        cancelType: 'IMMEDIATE_REFUND',
      });

      // 미리보기 금액과 실제 환불 금액이 반드시 일치해야 한다
      expect((result as { refundAmount: number }).refundAmount).toBe(expectedRefund);
      expect(wallet.refundByIntent).toHaveBeenCalledWith('intent_1', expectedRefund, 'EXPENSIVE', undefined, undefined);
      expect((await loadContract(contract.id)).eligibleRefundAmount).toBe(expectedRefund);
    });

    it('사용한 할인 혜택액을 추가로 차감한다', async () => {
      const { userId, contract, periodStart } = await givenSubscription({
        plan: 'annual',
        daysSincePeriodStart: 75,
        recurring: false,
      });
      // 기간 내 실제로 받은 할인 12,000원
      await db.db.insert(schema.membershipDiscountEvents).values({
        orderId: `order_${contract.id}`,
        userId,
        discountAmount: 12000,
        tierId,
        cycleStartDate: format(periodStart, 'yyyy-MM-dd'),
        subscriptionId: contract.id,
        orderDate: addDays(periodStart, 5),
      });

      const preview = await service.previewCancellation(userId);
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.breakdown?.benefitDeduction).toBe(12000);
      expect(immediate.refundAmount).toBe(34930 - 12000);
    });

    it('취소된 주문의 할인은 차감하지 않는다', async () => {
      const { userId, contract, periodStart } = await givenSubscription({
        plan: 'annual',
        daysSincePeriodStart: 75,
        recurring: false,
      });
      await db.db.insert(schema.membershipDiscountEvents).values({
        orderId: `order_cancelled_${contract.id}`,
        userId,
        discountAmount: 12000,
        tierId,
        cycleStartDate: format(periodStart, 'yyyy-MM-dd'),
        subscriptionId: contract.id,
        orderDate: addDays(periodStart, 5),
        isCancelled: true,
        cancelledAt: new Date(),
      });

      const preview = await service.previewCancellation(userId);
      expect(preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!.refundAmount).toBe(34930);
    });

    it('10개월 경과 후에는 환불액이 0이라 즉시해지를 막고 잔여기간 이용을 권한다', async () => {
      const { userId } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 310, recurring: false });

      const preview = await service.previewCancellation(userId);
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.available).toBe(false);
      expect(immediate.unavailableReason).toContain('환불 가능 금액이 없습니다');
      expect(preview.recommendedMode).toBe('AT_PERIOD_END');

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' }),
      ).rejects.toThrow(BadRequestError);
    });

    it('연간도 7일 내 무사용이면 전액 환불(청약철회)', async () => {
      const { userId } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 3, recurring: false });

      const preview = await service.previewCancellation(userId);
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.refundKind).toBe('WITHDRAWAL_FULL');
      expect(immediate.refundAmount).toBe(ANNUAL_PRICE);

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
      });
      expect((result as { refundAmount: number }).refundAmount).toBe(ANNUAL_PRICE);
    });
  });

  describe('고객 — 1회 결제(월간)', () => {
    it('해지해도 자격은 종료일까지 유지되고 안내 문구가 정기결제와 다르다', async () => {
      const { userId, contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 20, recurring: false });

      const preview = await service.previewCancellation(userId);
      expect(preview.isRecurring).toBe(false);

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'AT_PERIOD_END',
      });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(result.message).toContain('1회 결제');
      expect(result.message).not.toContain('정기결제가 중단');
      expect((await loadCurrentEntitlement(userId))?.endsAt).toBe(endsAt);
      expect((await loadContract(contract.id)).status).toBe('ACTIVE');
    });
  });

  describe('고객 — 환불 집행 경로', () => {
    it('자동이체(CMS)는 wallet 환불을 호출하지 않고 수동 송금 대기로 남긴다', async () => {
      wallet.getRefundability.mockResolvedValue({
        intentId: 'intent_1',
        refundableAmount: MONTHLY_PRICE,
        alreadyRefundedAmount: 0,
        autoRefundSupported: false,
        requiresReceiveAccount: false,
        methodTypes: ['CMS_BATCH'],
      });
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 1 });

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
        refundReceiveAccount: { bank: '20', accountNumber: '110123456789', holderName: '홍길동' },
      });

      expect((result as { refundStatus: string }).refundStatus).toBe('PENDING');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();

      const after = await loadContract(contract.id);
      expect(after.refundRequested).toBe(true);
      expect(after.refundCompleted).toBe(false); // 아직 돈이 나가지 않았다
      expect(await loadEventTypes(contract.id)).toContain('REFUND_PENDING');
    });

    it('수동 송금 대상인데 계좌가 없으면 해지를 거부한다', async () => {
      wallet.getRefundability.mockResolvedValue({
        intentId: 'intent_1',
        refundableAmount: MONTHLY_PRICE,
        alreadyRefundedAmount: 0,
        autoRefundSupported: false,
        requiresReceiveAccount: true,
        methodTypes: ['CMS_BATCH'],
      });
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 1 });

      await expect(
        service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' }),
      ).rejects.toThrow(BadRequestError);
      expect((await loadContract(contract.id)).status).toBe('ACTIVE');
    });

    it('wallet 환불 실패는 성공으로 위장하지 않고 계약에도 미완료로 남는다', async () => {
      wallet.refundByIntent.mockResolvedValue({
        status: 'FAILED',
        refundedAmount: 0,
        errorCode: 'PROVIDER_ERROR',
        errorMessage: 'PG 오류',
      });
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 1 });

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
      });

      expect((result as { refundStatus: string }).refundStatus).toBe('FAILED');
      const after = await loadContract(contract.id);
      expect(after.status).toBe('CANCELLED'); // 해지는 유지
      expect(after.refundCompleted).toBe(false);
      expect(await loadEventTypes(contract.id)).toContain('REFUND_FAILED');
    });

    it('무통장 수동 환불이 나중에 완료되면 계약에 기록된다 (wallet 환불성공 이벤트 경로)', async () => {
      wallet.refundByIntent.mockResolvedValue({ status: 'PENDING', refundedAmount: 0 });
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 1 });

      await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
        refundReceiveAccount: { bank: '20', accountNumber: '110123456789', holderName: '홍길동' },
      });
      expect((await loadContract(contract.id)).refundCompleted).toBe(false);

      // 관리자가 계좌 송금 후 wallet 이 gateway.refund.succeeded 를 발행한 상황
      await refundEventHandler.handleRefundCompleted({
        contractId: contract.id,
        userId,
        amount: MONTHLY_PRICE,
        walletTransactionId: 'refund_1',
        completedAt: new Date().toISOString(),
      });

      const after = await loadContract(contract.id);
      expect(after.refundCompleted).toBe(true);
      expect(after.refundCompletedAt).not.toBeNull();
      expect(await loadEventTypes(contract.id)).toContain('REFUND_COMPLETED');
    });
  });

  describe('고객 — 자동이체 약정 종료 (효성 CMS)', () => {
    it('CHARGE 경로 해지는 약정을 즉시 종료한다', async () => {
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      expect(wallet.terminateBillingMandate).toHaveBeenCalledWith(contract.id);
    });

    it('INVOICE 경로 해지예약은 남은 수금 때문에 약정 종료를 보류한다', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 20, billingPath: 'INVOICE' });

      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      expect(wallet.terminateBillingMandate).not.toHaveBeenCalled();
      // 해지예약은 인보이스를 void 하지 않는다(void 하면 무료 이용이 된다)
      expect(invoices.voidInvoicesForContract).not.toHaveBeenCalled();
    });

    it('INVOICE 경로 즉시해지는 인보이스를 무효화하고 약정도 종료한다', async () => {
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 1, billingPath: 'INVOICE' });

      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' });

      expect(invoices.voidInvoicesForContract).toHaveBeenCalledWith(contract.id, 'SUBSCRIPTION_CANCELLED');
      expect(wallet.terminateBillingMandate).toHaveBeenCalledWith(contract.id);
    });

    it('결제수단이 다른 구독과 공유되면 약정을 지우지 않고 후속 정리 대상으로도 남기지 않는다', async () => {
      wallet.terminateBillingMandate.mockResolvedValue({
        agreementFound: true,
        cancelledWithdrawals: 0,
        mandateTerminated: false,
        skipReason: 'BILLING_METHOD_IN_USE_BY_OTHER_AGREEMENT',
      });
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      expect(await loadEventTypes(contract.id)).not.toContain('AGREEMENT_REVOKE_PENDING');
    });

    it('약정 종료 실패는 해지를 되돌리지 않고 정리 대상으로 기록한다', async () => {
      wallet.terminateBillingMandate.mockRejectedValue(new Error('wallet down'));
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      const result = await service.cancelSubscription(userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'AT_PERIOD_END',
      });

      expect(result.type).toBe('RECURRING_CANCELLATION');
      expect(await loadEventTypes(contract.id)).toContain('AGREEMENT_REVOKE_PENDING');
      // 재청구는 DB 플래그로 이미 막혀 있다
      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      expect(due.map((d) => d.id)).not.toContain(contract.id);
    });
  });

  describe('고객 — 해지 철회', () => {
    it('해지 예약을 철회하면 자동결제가 재개된다', async () => {
      const { userId, contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 5 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      const result = await service.undoCancellation(userId, EMAIL);

      expect(result.type).toBe('CANCELLATION_UNDONE');
      expect(result.nextBillingDate).toBe(endsAt);

      const after = await loadContract(contract.id);
      expect(after.recurringCancelledAt).toBeNull();
      expect(after.recurringCancellationReasonCode).toBeNull();
      expect(after.autoRenewal).toBe(true);
      expect(after.nextBillingDate).toBe(endsAt);
      expect(await loadEventTypes(contract.id)).toContain('RECURRING_CANCELLATION_UNDONE');

      // 약정을 먼저 복구했는지
      expect(wallet.createBillingAgreement).toHaveBeenCalledWith(userId, contract.id);

      // 이제 다시 청구 대상이 된다
      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      expect(due.map((d) => d.id)).toContain(contract.id);
    });

    it('약정 복구가 실패하면 상태를 되살리지 않는다 (청구 불가 좀비 계약 방지)', async () => {
      wallet.createBillingAgreement.mockRejectedValue(new Error('BILLING_METHOD_NOT_ACTIVE'));
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      await expect(service.undoCancellation(userId, EMAIL)).rejects.toThrow('BILLING_METHOD_NOT_ACTIVE');

      const after = await loadContract(contract.id);
      expect(after.autoRenewal).toBe(false);
      expect(after.recurringCancelledAt).not.toBeNull();
    });

    it('해지 예약이 아닌 구독은 철회할 수 없다', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 5 });
      await expect(service.undoCancellation(userId, EMAIL)).rejects.toThrow(ConflictError);
    });

    it('즉시해지된 구독은 철회할 수 없다 (활성 구독이 없다)', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 1 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' });

      await expect(service.undoCancellation(userId, EMAIL)).rejects.toThrow(NotFoundError);
    });
  });

  describe('고객 — 미리보기', () => {
    it('트라이얼(미결제) 중이면 환불 대상이 아니다', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 3, hasPayment: false });

      const preview = await service.previewCancellation(userId);
      const immediate = preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.available).toBe(false);
      expect(immediate.unavailableReason).toContain('결제 내역');
      expect(preview.options.find((o) => o.mode === 'AT_PERIOD_END')!.available).toBe(true);
    });

    it('남은 청약철회 기간과 이용 종료일을 알려준다', async () => {
      const { userId, endsAt } = await givenSubscription({ daysSincePeriodStart: 2 });

      const preview = await service.previewCancellation(userId);
      expect(preview.withdrawalDaysRemaining).toBe(5);
      expect(preview.withdrawalWindowDays).toBe(7);
      expect(preview.currentPeriodEndsAt).toBe(endsAt);
      expect(preview.options.find((o) => o.mode === 'AT_PERIOD_END')!.effectiveEndsAt).toBe(endsAt);
    });

    it('해지 예약 상태를 그대로 노출한다 (화면이 해지일·종료일을 표시할 수 있어야 한다)', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 5 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });

      const preview = await service.previewCancellation(userId);
      expect(preview.alreadyScheduledForCancellation).toBe(true);
      expect(preview.recurringCancelledAt).not.toBeNull();
      expect(preview.isRecurring).toBe(true);
    });

    it('활성 구독이 없으면 404', async () => {
      await expect(service.previewCancellation('nobody')).rejects.toThrow(NotFoundError);
    });
  });

  // ───────────────────────── 관리자 시나리오 ─────────────────────────

  describe('관리자 — 강제 해지 + 환불', () => {
    it('정책 산정액 이내 부분 환불은 허용된다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75, recurring: false });

      const result = await service.forceCancelSubscription(
        contract.id,
        'admin_1',
        '고객 요청',
        'PARTIAL',
        30000,
        undefined,
        undefined,
        false,
        EMAIL,
      );

      expect(result.refundAmount).toBe(30000);
      expect(result.refundStatus).toBe('COMPLETED');
      const after = await loadContract(contract.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.cancellationReasonCode).toBe('ADMIN_FORCED');
      expect(after.refundCompleted).toBe(true);
      expect(await loadCurrentEntitlement(contract.userId)).toBeUndefined();
    });

    it('정책 산정액 초과 환불은 초과 권한 없이는 거부되고 계약도 그대로 남는다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75, recurring: false });

      await expect(
        service.forceCancelSubscription(contract.id, 'admin_1', '고객 요청', 'FULL', undefined, undefined, undefined, false),
      ).rejects.toThrow(ForbiddenError);

      const after = await loadContract(contract.id);
      expect(after.status).toBe('ACTIVE');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect(await loadCurrentEntitlement(contract.userId)).toBeDefined();
    });

    it('초과 권한이 있으면 정책을 넘겨 환불할 수 있다 (장애 보상)', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75, recurring: false });

      const result = await service.forceCancelSubscription(
        contract.id,
        'master_1',
        '서비스 장애 보상',
        'FULL',
        undefined,
        undefined,
        undefined,
        true,
      );

      expect(result.refundAmount).toBe(ANNUAL_PRICE);
      expect(wallet.refundByIntent).toHaveBeenCalledWith(
        'intent_1',
        ANNUAL_PRICE,
        'ADMIN_CANCEL',
        '서비스 장애 보상',
        undefined,
      );
    });

    it('환불 없는 강제 취소는 상한 검사를 건너뛰고 자격만 회수한다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 310, recurring: false });

      const result = await service.forceCancelSubscription(
        contract.id,
        'admin_1',
        '중복 가입 정리',
        'NONE',
        undefined,
        undefined,
        undefined,
        false,
      );

      expect(result.refundStatus).toBe('NOT_APPLICABLE');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect((await loadContract(contract.id)).status).toBe('CANCELLED');
    });

    it('환불 결과를 사실대로 보고하고 이벤트에도 확정 상태를 싣는다', async () => {
      wallet.refundByIntent.mockResolvedValue({ status: 'FAILED', refundedAmount: 0, errorCode: 'CMS_REFUND_NOT_SUPPORTED' });
      const { contract } = await givenSubscription({ daysSincePeriodStart: 10 });

      const result = await service.forceCancelSubscription(
        contract.id,
        'admin_1',
        '고객 요청',
        'PARTIAL',
        1000,
        undefined,
        undefined,
        false,
        EMAIL,
      );

      expect(result.refundStatus).toBe('FAILED');
      // 이벤트는 환불 확정 후에 발행돼야 한다
      expect(events.publishStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CANCELLED', refundStatus: 'FAILED', email: EMAIL }),
      );
    });

    it('정책상 환불 불가한 월간 계약에도 소액 보상은 admin 재량으로 가능하다', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      const result = await service.forceCancelSubscription(
        contract.id,
        'admin_1',
        '배송 지연 사과',
        'PARTIAL',
        MONTHLY_PRICE,
        undefined,
        undefined,
        false,
      );

      expect(result.refundAmount).toBe(MONTHLY_PRICE);
      expect(result.refundStatus).toBe('COMPLETED');
    });

    it('재량 한도(월 정가)를 넘으면 초과 권한이 필요하다', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 20 });

      await expect(
        service.forceCancelSubscription(
          contract.id,
          'admin_1',
          '과다 보상',
          'PARTIAL',
          MONTHLY_PRICE + 1,
          undefined,
          undefined,
          false,
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('환불 대상 결제가 없으면 환불을 성공으로 위장하지 않는다 (무료 지급 회원)', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5, hasPayment: false });

      const result = await service.forceCancelSubscription(
        contract.id,
        'admin_1',
        '오지급 정리',
        'PARTIAL',
        MONTHLY_PRICE,
        undefined,
        undefined,
        false,
      );

      expect(result.refundStatus).toBe('FAILED');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
      expect((await loadContract(contract.id)).refundCompleted).toBe(false);
      expect(await loadEventTypes(contract.id)).toContain('REFUND_FAILED');
    });

    it('없는 계약이면 404', async () => {
      await expect(
        service.forceCancelSubscription(
          '00000000-0000-0000-0000-000000000000',
          'admin_1',
          '테스트',
          'NONE',
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('해지 견적을 계약 ID 로 조회할 수 있다 (관리자 계산기)', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75, recurring: false });

      const quote = await service.previewCancellationByContract(contract.id);

      expect(quote.contractId).toBe(contract.id);
      expect(quote.planName).toEqual({ durationDays: 365, price: ANNUAL_PRICE });
      const immediate = quote.options.find((o) => o.mode === 'IMMEDIATE_REFUND')!;
      expect(immediate.refundAmount).toBe(34930);
      expect(immediate.breakdown?.usageDeduction).toBe(14970);
    });
  });

  describe('관리자 — 자동갱신 토글(해지예약/철회)', () => {
    it('자동갱신을 끄면 해지 예약되고 재청구가 멈춘다', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });

      await adminReader.updateAutoRenewal(contract.id, false, 'admin_1');

      const after = await loadContract(contract.id);
      expect(after.autoRenewal).toBe(false);
      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      expect(due.map((d) => d.id)).not.toContain(contract.id);
    });

    it('자동갱신 재활성은 약정을 먼저 복구한 뒤 커밋한다', async () => {
      const { userId, contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 5 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' });
      jest.clearAllMocks();
      wallet.createBillingAgreement.mockResolvedValue(undefined);

      await adminReader.updateAutoRenewal(contract.id, true, 'admin_1');

      expect(wallet.createBillingAgreement).toHaveBeenCalled();
      const after = await loadContract(contract.id);
      expect(after.autoRenewal).toBe(true);
      expect(after.nextBillingDate).toBe(endsAt);
    });

    it('만료된 구독은 자동갱신 재활성으로 복구되지 않는다', async () => {
      const { userId, contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      await service.cancelSubscription(userId, EMAIL, { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' });

      await expect(adminReader.updateAutoRenewal(contract.id, true, 'admin_1')).rejects.toThrow(ConflictError);
    });
  });

  describe('교차 검증 — 해지 후 청구 스케줄러', () => {
    it('해지된 계약은 어떤 경로로든 다시 청구되지 않는다', async () => {
      const immediate = await givenSubscription({ daysSincePeriodStart: 1 });
      const scheduled = await givenSubscription({ daysSincePeriodStart: 20 });
      const forced = await givenSubscription({ daysSincePeriodStart: 10 });
      const active = await givenSubscription({ daysSincePeriodStart: 10 });

      await service.cancelSubscription(immediate.userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'IMMEDIATE_REFUND',
      });
      await service.cancelSubscription(scheduled.userId, EMAIL, {
        reasonCode: 'NOT_USING',
        cancelType: 'AT_PERIOD_END',
      });
      await service.forceCancelSubscription(forced.contract.id, 'admin_1', '정리', 'NONE');

      const due = await billingReader.findDueContracts(format(addDays(new Date(), 400), 'yyyy-MM-dd'));
      const dueIds = due.map((d) => d.id);

      expect(dueIds).not.toContain(immediate.contract.id);
      expect(dueIds).not.toContain(scheduled.contract.id);
      expect(dueIds).not.toContain(forced.contract.id);
      // 해지하지 않은 계약은 여전히 청구 대상이어야 한다(가드가 과하게 걸리지 않았는지)
      expect(dueIds).toContain(active.contract.id);
    });
  });
});
