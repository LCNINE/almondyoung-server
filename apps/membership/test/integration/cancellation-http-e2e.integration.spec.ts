/**
 * 멤버십 해지·환불 HTTP 계층 E2E.
 *
 * 서비스 계층 E2E(cancellation-e2e)가 상태 전이를 검증하는 반면, 여기서는 **HTTP 경계**를 검증한다:
 * 라우팅, JwtAuthGuard, ScopeGuard + @RequireScopes, zod 검증, 도메인 예외 → 상태코드 매핑.
 * 스코프는 auth.role_scope_mapping DB 조회로 결정되므로 실제 부트스트랩된 행을 그대로 쓴다.
 *
 * 실행: npm run test:membership:cancellation-e2e  (같은 스크립트가 함께 돌린다)
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import { sql } from 'drizzle-orm';
import { sign } from 'jsonwebtoken';
import { addDays, format, subDays } from 'date-fns';
import { eq } from 'drizzle-orm';
import { DbModule, DbService } from '@app/db';
import { AuthorizationModule, JwtAuthGuard, ScopeGuard } from '@app/authorization';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import * as schema from '../../src/shared/schemas/entities/schema';
import { membershipSchema } from '../../src/shared/schemas/entities/schema';
import { MEMBERSHIP_ROLE_MAPPINGS, MEMBERSHIP_SCOPES } from '../../src/shared/auth/membership-scopes';
import { SubscriptionController } from '../../src/controllers/subscription.controller';
import { AdminOperationsController } from '../../src/controllers/admin-operations.controller';
import { SubscriptionCancellationService } from '../../src/services/subscription-cancellation.service';
import { SubscriptionCancellationManager } from '../../src/services/subscription/subscription-cancellation.manager';
import { SubscriptionContractReader } from '../../src/services/subscription/subscription-contract.reader';
import { CancellationContextReader } from '../../src/services/subscription/cancellation-context.reader';
import { RefundPolicyService } from '../../src/services/subscription/refund-policy.service';
import { CancellationReasonReader } from '../../src/services/subscription/cancellation-reason.reader';
import { ContractEventManager } from '../../src/services/subscription/contract-event.manager';
import { BenefitReader } from '../../src/services/benefit/benefit.reader';
import { PauseReader } from '../../src/services/pause/pause.reader';
import { BillingReader } from '../../src/services/billing/billing.reader';
import { PaymentClientService } from '../../src/services/billing/payment-client.service';
import { MembershipEventPublisher } from '../../src/services/membership-event.publisher';
import { InvoiceBillingManager } from '../../src/services/billing/invoice-billing.manager';
import { AdminMembersReader } from '../../src/services/admin/admin-members.reader';
import { AdminOperationsService } from '../../src/services/admin-operations.service';
import { SubscriptionService } from '../../src/services/subscription.service';
import { AdminIdempotencyService } from '../../src/shared/idempotency/admin-idempotency.service';
import { AdminIdempotencyInterceptor } from '../../src/shared/idempotency/admin-idempotency.interceptor';

const AUTH_SECRET = 'membership-http-e2e-secret';
const MONTHLY_PRICE = 4990;
const ANNUAL_PRICE = 49900;

const isDedicatedRun = process.env.MEMBERSHIP_CANCELLATION_E2E === '1' && !!process.env.DATABASE_URL;
const describeE2E = isDedicatedRun ? describe : describe.skip;

describeE2E('멤버십 해지·환불 HTTP E2E', () => {
  let app: NestFastifyApplication;
  let module: TestingModule;
  let db: DbService<typeof membershipSchema>;

  let tierId: string;
  let monthlyPlanId: string;
  let annualPlanId: string;

  const wallet = {
    getRefundability: jest.fn(),
    refundByIntent: jest.fn(),
    terminateBillingMandate: jest.fn(),
    revokeBillingAgreement: jest.fn(),
    createBillingAgreement: jest.fn(),
  };
  const events = { publishStatusChanged: jest.fn(), saveStatusChanged: jest.fn() };
  const invoices = { voidInvoicesForContract: jest.fn(), issueInvoiceForContract: jest.fn() };

  /** 실제 앱과 동일한 형태의 HS256 토큰 (sub/roles/email) */
  function token(params: { userId: string; roles: string[]; email?: string }) {
    return sign(
      { sub: params.userId, roles: params.roles, email: params.email ?? 'e2e@example.com' },
      AUTH_SECRET,
      { algorithm: 'HS256', expiresIn: '10m' },
    );
  }

  const asCustomer = (userId: string) => ({ authorization: `Bearer ${token({ userId, roles: ['user'] })}` });
  const asAdmin = () => ({ authorization: `Bearer ${token({ userId: 'admin_1', roles: ['admin'] })}` });
  const asMaster = () => ({ authorization: `Bearer ${token({ userId: 'master_1', roles: ['master'] })}` });
  const asStranger = () => ({ authorization: `Bearer ${token({ userId: 'user_x', roles: ['user'] })}` });

  beforeAll(async () => {
    process.env.AUTH_SECRET = AUTH_SECRET;
    delete process.env.OIDC_ISSUER_URL;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        DbModule.forRoot({ config: { connectionString: process.env.DATABASE_URL }, schema: membershipSchema }),
        // 앱과 동일한 스코프 선언 — 부팅 시 auth.scopes / auth.role_scope_mapping 이 정합화된다.
        AuthorizationModule.forRoot({
          microserviceName: 'membership',
          scopes: MEMBERSHIP_SCOPES,
          roleMappings: MEMBERSHIP_ROLE_MAPPINGS,
        }),
      ],
      controllers: [SubscriptionController, AdminOperationsController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: ScopeGuard },
        SubscriptionCancellationService,
        SubscriptionCancellationManager,
        SubscriptionContractReader,
        CancellationContextReader,
        RefundPolicyService,
        CancellationReasonReader,
        ContractEventManager,
        BenefitReader,
        PauseReader,
        BillingReader,
        AdminMembersReader,
        // AdminOperationsService 는 멤버십 전체 서비스 그래프를 끌어온다. 이 스펙이 검증하는 라우트가
        // 쓰는 메서드만 실물 리더로 위임한다(자동갱신 토글은 실제 DB 경로를 그대로 탄다).
        {
          provide: AdminOperationsService,
          useFactory: (reader: AdminMembersReader) => ({
            setAutoRenewal: (contractId: string, autoRenewal: boolean, adminId: string) =>
              reader.updateAutoRenewal(contractId, autoRenewal, adminId),
          }),
          inject: [AdminMembersReader],
        },
        AdminIdempotencyService,
        AdminIdempotencyInterceptor,
        { provide: PaymentClientService, useValue: wallet },
        { provide: MembershipEventPublisher, useValue: events },
        { provide: InvoiceBillingManager, useValue: invoices },
        { provide: SubscriptionService, useValue: { getCurrentSubscriptionDetails: jest.fn() } },
      ],
    }).compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // main.ts 와 동일한 전역 파이프/필터 — DTO 검증과 상태코드 매핑을 실제 앱과 같게 만든다.
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    db = module.get<DbService<typeof membershipSchema>>(DbService);

    await wipeContracts();
    await db.db.delete(schema.plan);
    await db.db.delete(schema.tiers);

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
  }, 60000);

  afterAll(async () => {
    // tier/plan 을 남기면 같은 DB 를 쓰는 다른 스펙의 삽입이 유니크 충돌로 깨진다.
    await wipeContracts();
    await db.db.delete(schema.plan);
    await db.db.delete(schema.tiers);
    await app?.close();
    await module?.close();
  }, 30000);

  beforeEach(async () => {
    jest.clearAllMocks();
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
    await wipeContracts();
  });

  async function wipeContracts() {
    await db.db.delete(schema.adminOperationKeys);
    await db.db.delete(schema.membershipDunningQueue);
    await db.db.delete(schema.billingEvents);
    await db.db.delete(schema.subscriptionContractEvents);
    await db.db.delete(schema.subscriptionEntitlement);
    await db.db.delete(schema.subscriptionContracts);
    await db.db.delete(schema.eventBatches);
  }

  async function givenSubscription(params: { plan?: 'monthly' | 'annual'; daysSincePeriodStart: number }) {
    const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
    const isAnnual = params.plan === 'annual';
    const durationDays = isAnnual ? 365 : 30;
    const periodStart = subDays(new Date(), params.daysSincePeriodStart);
    const endsAt = addDays(periodStart, durationDays);

    const [contract] = await db.db
      .insert(schema.subscriptionContracts)
      .values({
        userId,
        planId: isAnnual ? annualPlanId : monthlyPlanId,
        billingDate: format(periodStart, 'yyyy-MM-dd'),
        nextBillingDate: format(endsAt, 'yyyy-MM-dd'),
        autoRenewal: !isAnnual,
        status: 'ACTIVE',
        billingPath: 'CHARGE',
        lastPaymentIntentId: 'intent_1',
      })
      .returning();

    await db.db.insert(schema.subscriptionEntitlement).values({
      userId,
      tierId,
      startsAt: format(periodStart, 'yyyy-MM-dd'),
      endsAt: format(endsAt, 'yyyy-MM-dd'),
      isCurrent: true,
    });

    // 이번 주기의 결제 사실. 청약철회 7일 창은 endsAt 역산이 아니라 이 시각을 기준으로 판정된다
    // (paymentIntentId 는 유니크 제약 때문에 null — 여기선 시각만 의미가 있다).
    if (params.hasPayment !== false) {
      await db.db.insert(schema.billingEvents).values({
        contractId: contract.id,
        eventType: 'CHARGE_SUCCESS',
        amount: isAnnual ? ANNUAL_PRICE : MONTHLY_PRICE,
        createdAt: periodStart,
      });
    }

    return { userId, contract, endsAt: format(endsAt, 'yyyy-MM-dd') };
  }

  const req = (opts: {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) => app.inject({ ...opts, payload: opts.payload as never });

  // ───────────────────────── 인증·인가 ─────────────────────────

  describe('인증', () => {
    it('토큰 없이 해지하면 401', async () => {
      const res = await req({ method: 'POST', url: '/subscriptions/cancel', payload: { reasonCode: 'NOT_USING' } });
      expect(res.statusCode).toBe(401);
    });

    it('토큰 없이 미리보기하면 401', async () => {
      expect((await req({ method: 'GET', url: '/subscriptions/cancel-preview' })).statusCode).toBe(401);
    });

    it('만료된 토큰은 401', async () => {
      const expired = sign({ sub: 'u1', roles: ['user'] }, AUTH_SECRET, { algorithm: 'HS256', expiresIn: '-1m' });
      const res = await req({
        method: 'GET',
        url: '/subscriptions/cancel-preview',
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('다른 사람 토큰으로는 남의 구독을 해지할 수 없다 (userId 는 토큰에서만 온다)', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });

      // 남의 구독을 노려도 본인(user_x) 기준으로 조회되므로 404 가 된다
      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asStranger(),
        payload: { reasonCode: 'NOT_USING' },
      });

      expect(res.statusCode).toBe(404);
      const [after] = await db.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contract.id));
      expect(after.status).toBe('ACTIVE');
    });

    it('일반 사용자는 관리자 API 에 접근할 수 없다 (403)', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      const res = await req({
        method: 'GET',
        url: `/admin/subscriptions/${contract.id}/cancellation-quote`,
        headers: asCustomer('user_1'),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('스코프 인가 (환불 금액 상한)', () => {
    it('부트스트랩이 스코프와 역할 매핑을 실제로 넣는다', async () => {
      const scopeRows = await db.db.execute<{ key: string }>(sql`SELECT key FROM auth.scopes ORDER BY key`);
      const keys = [...scopeRows].map((r) => r.key);
      expect(keys).toEqual(expect.arrayContaining(['membership.billing.refund', 'membership.billing.refund_override']));

      const mappings = await db.db.execute<{ role_name: string; key: string }>(
        sql`SELECT m.role_name, s.key
              FROM auth.role_scope_mapping m
              JOIN auth.scopes s ON s.id = m.scope_id
             ORDER BY m.role_name, s.key`,
      );
      const pairs = [...mappings].map((r) => `${r.role_name}:${r.key}`);
      // admin 은 일상 환불만, master 는 초과 환불까지
      expect(pairs).toEqual(
        expect.arrayContaining([
          'admin:membership.billing.refund',
          'master:membership.billing.refund',
          'master:membership.billing.refund_override',
        ]),
      );
      expect(pairs).not.toContain('admin:membership.billing.refund_override');
    });

    it('admin 은 정책 한도 이내 환불을 실행할 수 있다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75 });

      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/force-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `k-${contract.id}-1` },
        payload: { reason: '고객 요청', refundType: 'PARTIAL', refundAmount: 30000 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().refundAmount).toBe(30000);
      expect(res.json().refundStatus).toBe('COMPLETED');
    });

    it('admin 이 정책 한도를 넘기면 403 이고 계약은 그대로 남는다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75 });

      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/force-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `k-${contract.id}-2` },
        payload: { reason: '전액 환불 시도', refundType: 'FULL' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message ?? JSON.stringify(res.json())).toContain('별도 권한');

      const [after] = await db.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contract.id));
      expect(after.status).toBe('ACTIVE');
      expect(wallet.refundByIntent).not.toHaveBeenCalled();
    });

    it('해지 예약은 사유 없이는 400 이고 계약을 건드리지 않는다', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 10 });

      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/schedule-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `sc-${contract.id}-1` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const [after] = await db.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contract.id));
      expect(after.recurringCancelledAt).toBeNull();
      expect(after.autoRenewal).toBe(true);
    });

    it('admin 의 해지 예약은 사유와 함께 기록되고 자동결제만 끊는다', async () => {
      const { contract, endsAt } = await givenSubscription({ daysSincePeriodStart: 10 });

      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/schedule-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `sc-${contract.id}-2` },
        payload: { reason: '고객 전화 요청' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().currentPeriodEndsAt).toBe(endsAt);
      const [after] = await db.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contract.id));
      expect(after.status).toBe('ACTIVE');
      expect(after.recurringCancelledAt).not.toBeNull();
      expect(after.autoRenewal).toBe(false);
    });

    it('master 는 정책 한도를 넘겨 환불할 수 있다', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75 });

      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/force-cancel`,
        headers: { ...asMaster(), 'idempotency-key': `k-${contract.id}-3` },
        payload: { reason: '서비스 장애 보상', refundType: 'FULL' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().refundAmount).toBe(ANNUAL_PRICE);
    });
  });

  // ───────────────────────── 고객 경로 ─────────────────────────

  describe('고객 — 해지 API', () => {
    it('미리보기가 선택지와 금액을 내려준다', async () => {
      const { userId, endsAt } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75 });

      const res = await req({ method: 'GET', url: '/subscriptions/cancel-preview', headers: asCustomer(userId) });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.currentPeriodEndsAt).toBe(endsAt);
      expect(body.options).toHaveLength(2);
      expect(body.options.find((o: { mode: string }) => o.mode === 'IMMEDIATE_REFUND').refundAmount).toBe(34930);
    });

    it('활성 구독이 없으면 미리보기 404', async () => {
      const res = await req({ method: 'GET', url: '/subscriptions/cancel-preview', headers: asCustomer('nobody') });
      expect(res.statusCode).toBe(404);
    });

    it('해지예약 200 → 재해지 409', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 20 });

      const first = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().status).toBe('RECURRING_CANCELLED');

      const second = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' },
      });
      expect(second.statusCode).toBe(409);
    });

    it('정책상 불가한 즉시해지는 400 이고 사유가 응답에 담긴다', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 20 });

      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain('7일');
    });

    it('잘못된 cancelType 은 zod 가 400 으로 막는다', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 5 });

      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'RIGHT_NOW_PLEASE' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('reasonCode 누락은 400', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 5 });
      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('email 이 없는 토큰으로도 해지할 수 있다 (해지를 막는 것이 더 큰 피해다)', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 20 });
      const noEmail = sign({ sub: userId, roles: ['user'] }, AUTH_SECRET, {
        algorithm: 'HS256',
        expiresIn: '10m',
      });

      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: { authorization: `Bearer ${noEmail}` },
        payload: { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' },
      });

      expect(res.statusCode).toBe(200);
      // 이벤트 스키마(z.string().email())를 깨뜨리지 않도록 빈 문자열이 아니라 undefined 로 나가야 한다
      expect(events.publishStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
    });

    it('해지 철회 200, 대상이 아니면 409', async () => {
      const { userId } = await givenSubscription({ daysSincePeriodStart: 5 });

      const notScheduled = await req({ method: 'POST', url: '/subscriptions/cancel/undo', headers: asCustomer(userId) });
      expect(notScheduled.statusCode).toBe(409);

      await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'AT_PERIOD_END' },
      });

      const undone = await req({ method: 'POST', url: '/subscriptions/cancel/undo', headers: asCustomer(userId) });
      expect(undone.statusCode).toBe(200);
      expect(undone.json().status).toBe('ACTIVE');
    });

    it('무통장 환불인데 계좌를 안 보내면 400', async () => {
      wallet.getRefundability.mockResolvedValue({
        intentId: 'intent_1',
        refundableAmount: MONTHLY_PRICE,
        alreadyRefundedAmount: 0,
        autoRefundSupported: true,
        requiresReceiveAccount: true,
        methodTypes: ['BANK_TRANSFER'],
      });
      const { userId } = await givenSubscription({ daysSincePeriodStart: 1 });

      const res = await req({
        method: 'POST',
        url: '/subscriptions/cancel',
        headers: asCustomer(userId),
        payload: { reasonCode: 'NOT_USING', cancelType: 'IMMEDIATE_REFUND' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain('계좌');
    });
  });

  // ───────────────────────── 관리자 경로 ─────────────────────────

  describe('관리자 — 견적·강제해지 API', () => {
    it('견적 조회 200', async () => {
      const { contract } = await givenSubscription({ plan: 'annual', daysSincePeriodStart: 75 });

      const res = await req({
        method: 'GET',
        url: `/admin/subscriptions/${contract.id}/cancellation-quote`,
        headers: asAdmin(),
      });

      expect(res.statusCode).toBe(200);
      const immediate = res.json().options.find((o: { mode: string }) => o.mode === 'IMMEDIATE_REFUND');
      expect(immediate.breakdown.monthsElapsed).toBe(3);
    });

    it('없는 계약 견적은 404', async () => {
      const res = await req({
        method: 'GET',
        url: '/admin/subscriptions/00000000-0000-0000-0000-000000000000/cancellation-quote',
        headers: asAdmin(),
      });
      expect(res.statusCode).toBe(404);
    });

    it('같은 Idempotency-Key 로 강제해지를 두 번 보내도 환불은 한 번만 나간다', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      const headers = { ...asAdmin(), 'idempotency-key': `idem-${contract.id}` };
      const payload = { reason: '고객 요청', refundType: 'PARTIAL', refundAmount: 1000 };

      const first = await req({ method: 'POST', url: `/admin/subscriptions/${contract.id}/force-cancel`, headers, payload });
      const second = await req({ method: 'POST', url: `/admin/subscriptions/${contract.id}/force-cancel`, headers, payload });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(wallet.refundByIntent).toHaveBeenCalledTimes(1);
    });

    it('refundType 이 enum 밖이면 400', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/force-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `k-bad-${contract.id}` },
        payload: { reason: '테스트', refundType: 'EVERYTHING' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('사유 없는 강제해지는 400', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });
      const res = await req({
        method: 'POST',
        url: `/admin/subscriptions/${contract.id}/force-cancel`,
        headers: { ...asAdmin(), 'idempotency-key': `k-noreason-${contract.id}` },
        payload: { reason: '', refundType: 'NONE' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('자동갱신 토글(해지예약)로 200', async () => {
      const { contract } = await givenSubscription({ daysSincePeriodStart: 5 });

      const res = await req({
        method: 'PUT',
        url: `/admin/contracts/${contract.id}/auto-renewal`,
        headers: { ...asAdmin(), 'idempotency-key': `k-ar-${contract.id}` },
        payload: { autoRenewal: false },
      });

      expect(res.statusCode).toBe(200);
      const [after] = await db.db
        .select()
        .from(schema.subscriptionContracts)
        .where(eq(schema.subscriptionContracts.id, contract.id));
      expect(after.autoRenewal).toBe(false);
    });
  });
});
