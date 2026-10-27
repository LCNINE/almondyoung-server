import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { addDays, subDays } from 'date-fns';
import { DbModule, DbService } from '@app/db';
import { membershipSchema, type MembershipSchema } from '../../src/shared/schemas/entities/schema';
import * as schema from '../../src/shared/schemas/entities/schema';
import {
  ActiveSubscriptionExistsException,
  BadRequestException,
} from '../../src/shared/exceptions/subscription.exceptions';
import { SubscriptionService } from '../../src/services/subscription.service';
import { SubscriptionCreator } from '../../src/services/subscription/subscription.creator';
import { SubscriptionManager } from '../../src/services/subscription/subscription.manager';
import { SubscriptionCancellationManager } from '../../src/services/subscription/subscription-cancellation.manager';
import { SubscriptionContractReader } from '../../src/services/subscription/subscription-contract.reader';
import { ContractEventManager } from '../../src/services/subscription/contract-event.manager';
import { CancellationContextReader } from '../../src/services/subscription/cancellation-context.reader';
import { RefundPolicyService, isWithdrawalEligible } from '../../src/services/subscription/refund-policy.service';
import { EntitlementService } from '../../src/services/entitlement.service';
import { EntitlementReader } from '../../src/services/entitlement/entitlement.reader';
import { EntitlementManager } from '../../src/services/entitlement/entitlement.manager';
import { PlanService } from '../../src/services/plan.service';
import { PlanReader } from '../../src/services/plan/plan.reader';
import { PlanManager } from '../../src/services/plan/plan.manager';
import { BenefitReader } from '../../src/services/benefit/benefit.reader';
import { BenefitUsageManager } from '../../src/services/benefit/benefit-usage.manager';
import { PauseReader } from '../../src/services/pause/pause.reader';
import { PauseManager } from '../../src/services/pause/pause.manager';
import { SavingsService } from '../../src/services/savings/savings.service';
import { SavingsReader } from '../../src/services/savings/savings.reader';
import { TermsAgreementManager } from '../../src/services/terms/terms-agreement.manager';
import { ArrearsGate } from '../../src/services/arrears/arrears.gate';
import { ArrearsReader } from '../../src/services/arrears/arrears.reader';
import { MembershipPolicyService } from '../../src/services/membership-policy.service';
import { MembershipEventPublisher } from '../../src/services/membership-event.publisher';
import { PaymentClientService } from '../../src/services/billing/payment-client.service';
import { BillingManager } from '../../src/services/billing/billing.manager';
import { BillingReader } from '../../src/services/billing/billing.reader';
import { InvoiceBillingManager } from '../../src/services/billing/invoice-billing.manager';
import { BillingOutcomeHandler } from '../../src/services/billing/billing-outcome.handler';

// 실행: dotenv -e apps/membership/.env -- npx jest apps/membership/test/integration/grant-takeover --runInBand
// 바깥 환경의 DATABASE_URL 만 읽는다. 스스로 .env 를 읽으면 기본 게이트에 딸려 들어온다.
const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (process.env.REQUIRE_MEMBERSHIP_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the membership integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Plan = typeof schema.plan.$inferSelect;
type Tier = typeof schema.tiers.$inferSelect;

function withTimeouts(url: string): string {
  const u = new URL(url);
  u.searchParams.set('statement_timeout', '15000');
  u.searchParams.set('lock_timeout', '10000');
  return u.toString();
}

const postgresFn: typeof postgres =
  typeof postgres === 'function' ? postgres : ((postgres as { default?: typeof postgres }).default as typeof postgres);

const RUN_ID = Math.random().toString(36).slice(2, 10);
const TODAY = () => new Date().toISOString().split('T')[0];
const day = (d: Date) => d.toISOString().split('T')[0];

describeIfDb('임시 이용권 이어받기 (실 DB)', () => {
  let module: TestingModule;
  let db: DbService<MembershipSchema>;
  let creator: SubscriptionCreator;
  let subscriptionManager: SubscriptionManager;
  let cancellationManager: SubscriptionCancellationManager;
  let entitlementManager: EntitlementManager;
  let subscriptionService: SubscriptionService;
  let benefitUsage: BenefitUsageManager;
  let contextReader: CancellationContextReader;
  let billingOutcome: BillingOutcomeHandler;

  let plan: Plan;
  let tier: Tier;
  let seq = 0;
  const createdUserIds: string[] = [];

  const wallet = {
    getWalletPaymentIntent: jest.fn(),
    getRefundability: jest.fn(),
    refundByIntent: jest.fn(),
    createBillingAgreement: jest.fn(),
    revokeBillingAgreement: jest.fn(),
  };
  const events = {
    publishStatusChanged: jest.fn().mockResolvedValue(undefined),
    saveStatusChanged: jest.fn().mockResolvedValue(undefined),
  };

  const newUser = () => {
    const id = `it-grant-takeover-${RUN_ID}-${++seq}`;
    createdUserIds.push(id);
    return id;
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          // 교착이 나면 영원히 매달리지 않고 빨리 실패하게 한다
          config: { connectionString: withTimeouts(DATABASE_URL) },
          schema: membershipSchema,
        }),
      ],
      providers: [
        SubscriptionService,
        SubscriptionCreator,
        SubscriptionManager,
        SubscriptionCancellationManager,
        SubscriptionContractReader,
        ContractEventManager,
        CancellationContextReader,
        RefundPolicyService,
        EntitlementService,
        EntitlementReader,
        EntitlementManager,
        PlanService,
        PlanReader,
        PlanManager,
        BenefitReader,
        BenefitUsageManager,
        PauseReader,
        PauseManager,
        SavingsService,
        SavingsReader,
        TermsAgreementManager,
        ArrearsGate,
        ArrearsReader,
        MembershipPolicyService,
        BillingReader,
        BillingOutcomeHandler,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: MembershipEventPublisher, useValue: events },
        { provide: PaymentClientService, useValue: wallet },
        { provide: BillingManager, useValue: { processSingleBilling: jest.fn() } },
        {
          provide: InvoiceBillingManager,
          useValue: {
            issueInvoiceForContract: jest.fn().mockResolvedValue({ success: true }),
            voidInvoicesForContract: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    db = module.get(DbService);
    creator = module.get(SubscriptionCreator);
    subscriptionManager = module.get(SubscriptionManager);
    cancellationManager = module.get(SubscriptionCancellationManager);
    entitlementManager = module.get(EntitlementManager);
    subscriptionService = module.get(SubscriptionService);
    benefitUsage = module.get(BenefitUsageManager);
    contextReader = module.get(CancellationContextReader);
    billingOutcome = module.get(BillingOutcomeHandler);

    // 로컬 DB 의 기존 요금제를 읽기만 한다 (월간 30일). 없으면 이 스펙은 돌 수 없다.
    const [row] = await db.db
      .select({ plan: schema.plan, tier: schema.tiers })
      .from(schema.plan)
      .innerJoin(schema.tiers, eq(schema.plan.tierId, schema.tiers.id))
      .where(and(eq(schema.plan.durationDays, 30), eq(schema.plan.isActive, true), eq(schema.tiers.code, 'MEMBERSHIP')))
      .limit(1);
    if (!row) throw new Error('MEMBERSHIP 월간 활성 플랜이 로컬 DB 에 없다.');
    plan = row.plan;
    tier = row.tier;
  }, 60000);

  beforeEach(() => {
    jest.clearAllMocks();
    events.publishStatusChanged.mockResolvedValue(undefined);
    events.saveStatusChanged.mockResolvedValue(undefined);
    wallet.getRefundability.mockResolvedValue({
      intentId: 'x',
      refundableAmount: plan.price,
      alreadyRefundedAmount: 0,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      methodTypes: ['TOSS'],
    });
  });

  afterAll(async () => {
    try {
      if (db && createdUserIds.length > 0) await cleanup(createdUserIds);
    } finally {
      if (module) await module.close();
    }
  }, 30000);

  /** 이 스펙이 만든 회원의 행만 FK 순서대로 지운다. */
  async function cleanup(userIds: string[]) {
    const contracts = await db.db
      .select({ id: schema.subscriptionContracts.id })
      .from(schema.subscriptionContracts)
      .where(inArray(schema.subscriptionContracts.userId, userIds));
    const contractIds = contracts.map((c) => c.id);

    const batchIds = new Set<string>();
    const ents = await db.db
      .select({ s: schema.subscriptionEntitlement.sourceBatchId, c: schema.subscriptionEntitlement.closedBatchId })
      .from(schema.subscriptionEntitlement)
      .where(inArray(schema.subscriptionEntitlement.userId, userIds));
    for (const e of ents) [e.s, e.c].forEach((b) => b && batchIds.add(b));
    if (contractIds.length > 0) {
      const evs = await db.db
        .select({ b: schema.subscriptionContractEvents.batchId })
        .from(schema.subscriptionContractEvents)
        .where(inArray(schema.subscriptionContractEvents.contractId, contractIds));
      for (const e of evs) if (e.b) batchIds.add(e.b);
    }

    await db.db.delete(schema.membershipBenefitUsages).where(inArray(schema.membershipBenefitUsages.userId, userIds));
    if (contractIds.length > 0) {
      await db.db.delete(schema.billingEvents).where(inArray(schema.billingEvents.contractId, contractIds));
      await db.db
        .delete(schema.membershipDunningQueue)
        .where(inArray(schema.membershipDunningQueue.contractId, contractIds));
      await db.db
        .delete(schema.subscriptionContractEvents)
        .where(inArray(schema.subscriptionContractEvents.contractId, contractIds));
    }
    await db.db.delete(schema.subscriptionEntitlement).where(inArray(schema.subscriptionEntitlement.userId, userIds));
    if (contractIds.length > 0) {
      await db.db.delete(schema.subscriptionContracts).where(inArray(schema.subscriptionContracts.id, contractIds));
    }
    if (batchIds.size > 0) {
      await db.db.delete(schema.eventBatches).where(inArray(schema.eventBatches.id, [...batchIds]));
    }
  }

  async function giveGrant(userId: string, days: number) {
    const g = await entitlementManager.grantByDays(userId, days, 'it', 'it-admin');
    return { contractId: g.contractId, endsAt: g.entitlement.endsAt };
  }

  const loadContract = (id: string) =>
    db.db
      .select()
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.id, id))
      .limit(1)
      .then((r) => r[0]);

  const currentEntitlements = (userId: string) =>
    db.db
      .select()
      .from(schema.subscriptionEntitlement)
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      );

  /** 지급분이 자연스럽게 만료된 모양으로 만든다: 11일 전 시작, 어제 종료 */
  async function makeGrantExpired(userId: string) {
    await db.db
      .update(schema.subscriptionEntitlement)
      .set({ startsAt: day(subDays(new Date(), 11)), endsAt: day(subDays(new Date(), 1)) })
      .where(
        and(eq(schema.subscriptionEntitlement.userId, userId), eq(schema.subscriptionEntitlement.isCurrent, true)),
      );
    const [ent] = await currentEntitlements(userId);
    return ent;
  }

  /**
   * 다른 연결이 회원 잠금을 쥔 동안, 경로가 바로 그 잠금을 기다리는 모습(pg_locks 의 대기자)을 직접 본다.
   * 시간만 재면 느린 쿼리와 구분되지 않는다. 대기자를 확인한 뒤 잠금을 놓으면 경로가 끝나야 한다.
   */
  async function expectBlockedByUserLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
    const sqlClient = postgresFn(DATABASE_URL, { max: 2 });
    let conn: Awaited<ReturnType<typeof sqlClient.reserve>> | undefined;
    let holderOpen = false;
    let pending: Promise<T> | undefined;
    const releaseHolder = async () => {
      if (!conn || !holderOpen) return;
      holderOpen = false;
      await conn`rollback`;
    };
    try {
      conn = await sqlClient.reserve();
      await conn`begin`;
      holderOpen = true;
      await conn`select pg_advisory_xact_lock(hashtext(${`membership-signup:${userId}`}))`;
      const [mine] = await conn`
        select classid, objid, objsubid, pg_backend_pid() as pid from pg_locks
        where locktype = 'advisory' and granted and pid = pg_backend_pid()`;
      expect(mine).toBeDefined();

      let outcome: { settled: true; error?: unknown } | undefined;
      pending = run();
      void pending.then(
        () => (outcome = { settled: true }),
        (error: unknown) => (outcome = { settled: true, error }),
      );

      let waiter = false;
      for (let i = 0; i < 60 && !waiter && !outcome; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const rows = await sqlClient`
          select 1 from pg_locks
          where locktype = 'advisory' and not granted
            and classid = ${mine.classid} and objid = ${mine.objid} and objsubid = ${mine.objsubid}
            and pid <> ${mine.pid}`;
        waiter = rows.length > 0;
      }
      // 잠금을 쥔 동안 경로가 끝나 버렸다면 그 경로는 이 회원 잠금을 기다리지 않는다
      expect(outcome).toBeUndefined();
      expect(waiter).toBe(true);

      await releaseHolder();
      return await Promise.race([
        pending,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('잠금을 놓은 뒤에도 경로가 끝나지 않는다')), 10000),
        ),
      ]);
    } finally {
      try {
        await releaseHolder();
      } finally {
        conn?.release();
        if (pending) await pending.catch(() => undefined);
        await sqlClient.end({ timeout: 5 });
      }
    }
  }

  const takeover = (
    userId: string,
    grant: { contractId: string; endsAt: string },
    mode: 'recurring' | 'one_time',
    intent?: string,
  ) =>
    creator.createNewSubscription(
      userId,
      plan,
      tier,
      intent ? { initialPaymentIntentId: intent, initialPaymentAmount: plan.price } : {},
      mode,
      false,
      'CHARGE',
      '',
      { grantContractId: grant.contractId, grantEndsAt: grant.endsAt },
    );

  it('즉시해지 후 임시 이용권이 복구되고, 같은 결제의 환불 재배달이 복구분을 닫지 않는다', async () => {
    const userId = newUser();
    const grant = await giveGrant(userId, 10);
    const intent = `it-intent-${RUN_ID}-s1`;
    const created = await takeover(userId, grant, 'recurring', intent);
    const contract = await loadContract(created.contractId);
    expect(contract.billingDate).toBe(day(addDays(new Date(), 10)));

    await cancellationManager.cancelImmediately(userId, contract, plan, 'NOT_USING', undefined, {
      eligible: true,
      reason: 'it',
      amount: plan.price,
    });

    const after = await currentEntitlements(userId);
    expect(after).toHaveLength(1);
    expect(after[0].endsAt).toBe(contract.billingDate);
    expect(after[0].id).not.toBe(created.entitlementId);
    const restoredId = after[0].id;

    // 재배달: 읽은 뒤 해지된 계약의 옛 스냅샷으로 환불 회수가 다시 들어온다
    await expect(subscriptionManager.voidSubscription(userId, contract, 'refund-redelivery')).resolves.toEqual(
      expect.objectContaining({ contractId: contract.id }),
    );
    // 실제 재배달 경로: wallet 이 전액 환불로 답하게 하고 결제 intent 로 회수를 요청한다
    wallet.getRefundability.mockResolvedValue({
      intentId: intent,
      refundableAmount: 0,
      alreadyRefundedAmount: plan.price,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      methodTypes: ['TOSS'],
    });
    await subscriptionService.voidByPaymentIntent(intent, 'refund-redelivery', plan.price);
    // 해지 경로 재진입도 막힌다
    await expect(
      cancellationManager.cancelImmediately(userId, contract, plan, 'NOT_USING', undefined, {
        eligible: true,
        reason: 'it',
        amount: plan.price,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const final = await currentEntitlements(userId);
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe(restoredId);
    expect((await loadContract(created.contractId)).status).toBe('CANCELLED');
  }, 30000);

  it('임시 기간 혜택 사용과 유료 기간 재사용이 다른 행으로 남고, 유료 기간 사용만 청약철회를 막는다', async () => {
    const userId = newUser();
    const grant = await giveGrant(userId, 3);
    const created = await takeover(userId, grant, 'one_time', `it-intent-${RUN_ID}-s2`);
    const contract = await loadContract(created.contractId);

    // 임시 구간: 확인 없이 기록되고, 청약철회 판정에는 잡히지 않는다
    expect(await benefitUsage.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).toEqual({ status: 'RECORDED' });
    const [firstEnt] = await currentEntitlements(userId);
    const [firstUsage] = await db.db
      .select()
      .from(schema.membershipBenefitUsages)
      .where(eq(schema.membershipBenefitUsages.userId, userId));
    // 임시 구간 키는 자격 개시일이다. 미래의 유료 시작일이 키로 저장되면 유료 구간 첫 사용이 막힌다
    expect(firstUsage.periodStart.toISOString()).toBe(new Date(firstEnt.startsAt).toISOString());

    // 6일이 흐른 것처럼 관련 날짜를 전부 같은 만큼 당긴다 (grant 3일 -> billingDate 는 3일 전이 된다)
    const six = sql`interval '6 days'`;
    await db.db
      .update(schema.membershipBenefitUsages)
      .set({
        usedAt: sql`${schema.membershipBenefitUsages.usedAt} - ${six}`,
        periodStart: sql`${schema.membershipBenefitUsages.periodStart} - ${six}`,
      })
      .where(eq(schema.membershipBenefitUsages.userId, userId));
    await db.db
      .update(schema.billingEvents)
      .set({ createdAt: sql`${schema.billingEvents.createdAt} - ${six}` })
      .where(eq(schema.billingEvents.contractId, contract.id));
    await db.db
      .update(schema.subscriptionContracts)
      .set({
        billingDate: sql`${schema.subscriptionContracts.billingDate} - 6`,
        createdAt: sql`${schema.subscriptionContracts.createdAt} - ${six}`,
      })
      .where(eq(schema.subscriptionContracts.id, contract.id));
    await db.db
      .update(schema.subscriptionEntitlement)
      .set({
        startsAt: sql`${schema.subscriptionEntitlement.startsAt} - 6`,
        endsAt: sql`${schema.subscriptionEntitlement.endsAt} - 6`,
      })
      .where(eq(schema.subscriptionEntitlement.id, firstEnt.id));
    expect((await loadContract(contract.id)).billingDate).toBe(day(subDays(new Date(), 3)));

    const ctx1 = await contextReader.load({ contract: await loadContract(contract.id), plan });
    expect(ctx1).not.toBeNull();
    expect(ctx1!.currentPeriodBenefit.beautytopPremium).toBe(false);
    expect(
      isWithdrawalEligible({
        periodStart: new Date(ctx1!.benefitPeriodStart!),
        now: new Date(),
        usage: ctx1!.currentPeriodBenefit,
      }),
    ).toBe(true);

    // 유료 구간 첫 사용: 철회권이 남아 있으니 동의가 필요하다. 동의하면 새 행으로 기록된다
    expect(await benefitUsage.recordUsage(userId, 'BEAUTYTOP_PREMIUM', false)).toMatchObject({
      status: 'CONFIRMATION_REQUIRED',
    });
    expect(await benefitUsage.recordUsage(userId, 'BEAUTYTOP_PREMIUM', true)).toEqual({ status: 'RECORDED' });
    expect(await benefitUsage.recordUsage(userId, 'BEAUTYTOP_PREMIUM', true)).toEqual({ status: 'ALREADY_RECORDED' });

    const rows = await db.db
      .select()
      .from(schema.membershipBenefitUsages)
      .where(eq(schema.membershipBenefitUsages.userId, userId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.periodStart.toISOString())).size).toBe(2);

    const ctx2 = await contextReader.load({ contract: await loadContract(contract.id), plan });
    expect(ctx2!.currentPeriodBenefit.beautytopPremium).toBe(true);
    expect(
      isWithdrawalEligible({
        periodStart: new Date(ctx2!.benefitPeriodStart!),
        now: new Date(),
        usage: ctx2!.currentPeriodBenefit,
      }),
    ).toBe(false);
  }, 30000);

  it('같은 intent 동시 확정 두 번 → 계약 1개, 두 번째는 ActiveSubscriptionExistsException', async () => {
    const userId = newUser();
    await giveGrant(userId, 10);
    const intentId = `it-intent-${RUN_ID}-s3`;
    wallet.getWalletPaymentIntent.mockResolvedValue({
      id: intentId,
      status: 'CAPTURED',
      payableAmount: plan.price,
      metadata: { userId, planId: plan.id, email: '', billingMode: 'one_time' },
    });

    const results = await Promise.allSettled([
      subscriptionService.confirmCheckoutIntent(intentId),
      subscriptionService.confirmCheckoutIntent(intentId),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ActiveSubscriptionExistsException);

    const byIntent = await db.db
      .select({ id: schema.subscriptionContracts.id })
      .from(schema.subscriptionContracts)
      .where(eq(schema.subscriptionContracts.lastPaymentIntentId, intentId));
    expect(byIntent).toHaveLength(1);
    expect(await currentEntitlements(userId)).toHaveLength(1);
  }, 30000);

  it('확정 도중 지급분 만료 → 남은 일수 0으로 가입', async () => {
    const userId = newUser();
    const grant = await giveGrant(userId, 10);
    // 만료 크론이 먼저 지급분을 닫은 상황: 종료일이 지난 지급분을 실제 만료 처리 경로로 닫는다
    const ent = await makeGrantExpired(userId);
    await billingOutcome.handleExpiration(ent.id, userId, grant.contractId);
    expect((await loadContract(grant.contractId)).status).toBe('EXPIRED');

    // 호출부는 만료 전에 읽은 이어받기 정보(남은 10일짜리)를 들고 있다
    const stale = { contractId: grant.contractId, endsAt: day(addDays(new Date(), 10)) };
    const created = await takeover(userId, stale, 'one_time', `it-intent-${RUN_ID}-s4`);

    const contract = await loadContract(created.contractId);
    expect(contract.billingDate).toBe(TODAY());
    const [current] = await currentEntitlements(userId);
    expect(current.id).toBe(created.entitlementId);
    expect(current.endsAt).toBe(day(addDays(new Date(), plan.durationDays)));
    // 만료된 지급 계약은 이어받기로 덮어쓰지 않는다
    expect((await loadContract(grant.contractId)).status).toBe('EXPIRED');
  }, 30000);

  it('가입과 만료를 동시에 → 교착 없이 둘 다 끝난다', async () => {
    const ROUNDS = 8;
    for (let i = 0; i < ROUNDS; i++) {
      const userId = newUser();
      const grant = await giveGrant(userId, 10);
      const ent = await makeGrantExpired(userId);

      const results = await Promise.allSettled([
        takeover(
          userId,
          { contractId: grant.contractId, endsAt: ent.endsAt },
          'recurring',
          `it-intent-${RUN_ID}-s5-${i}`,
        ),
        billingOutcome.handleExpiration(ent.id, userId, grant.contractId),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const current = await currentEntitlements(userId);
      expect(current).toHaveLength(1);
      const created = results[0] as PromiseFulfilledResult<{ entitlementId: string }>;
      expect(current[0].id).toBe(created.value.entitlementId);

      // 지급 계약의 끝은 둘 중 하나로만 일관돼야 한다: 이어받기로 닫혔거나 만료로 닫혔거나
      const grantContract = await loadContract(grant.contractId);
      const types = (
        await db.db
          .select({ t: schema.subscriptionContractEvents.eventType })
          .from(schema.subscriptionContractEvents)
          .where(eq(schema.subscriptionContractEvents.contractId, grant.contractId))
      ).map((r) => r.t);
      if (grantContract.status === 'EXPIRED') {
        expect(types).toContain('EXPIRED');
        expect(types).not.toContain('SUPERSEDED_BY_SUBSCRIPTION');
      } else {
        expect(grantContract.status).toBe('CANCELLED');
        expect(types).toContain('SUPERSEDED_BY_SUBSCRIPTION');
        expect(types).not.toContain('EXPIRED');
      }
    }
  }, 60000);

  describe('회원 잠금 (다른 연결이 잠금을 쥐면 경로가 멈추고, 놓으면 끝난다)', () => {
    const eligibility = { eligible: true, reason: 'it', amount: 0 };

    it('이어받기 가입', async () => {
      const userId = newUser();
      const grant = await giveGrant(userId, 5);
      const created = await expectBlockedByUserLock(userId, () =>
        takeover(userId, grant, 'recurring', `it-intent-${RUN_ID}-lock-signup`),
      );
      expect(created.contractId).toBeDefined();
    }, 30000);

    it('만료 처리', async () => {
      const userId = newUser();
      const grant = await giveGrant(userId, 5);
      const ent = await makeGrantExpired(userId);
      await expectBlockedByUserLock(userId, () => billingOutcome.handleExpiration(ent.id, userId, grant.contractId));
      expect((await loadContract(grant.contractId)).status).toBe('EXPIRED');
    }, 30000);

    it('구독 무효화(voidSubscription)', async () => {
      const userId = newUser();
      const grant = await giveGrant(userId, 5);
      const created = await takeover(userId, grant, 'recurring', `it-intent-${RUN_ID}-lock-void`);
      const contract = await loadContract(created.contractId);
      await expectBlockedByUserLock(userId, () => subscriptionManager.voidSubscription(userId, contract, 'it'));
      expect((await loadContract(created.contractId)).status).toBe('CANCELLED');
    }, 30000);

    it('즉시 해지', async () => {
      const userId = newUser();
      const grant = await giveGrant(userId, 5);
      const created = await takeover(userId, grant, 'recurring', `it-intent-${RUN_ID}-lock-cancel`);
      const contract = await loadContract(created.contractId);
      await expectBlockedByUserLock(userId, () =>
        cancellationManager.cancelImmediately(userId, contract, plan, 'NOT_USING', undefined, eligibility),
      );
      expect((await loadContract(created.contractId)).status).toBe('CANCELLED');
    }, 30000);
  });
});
