/**
 * 관리자 «사람 축» 요약·목록과 미납 조정 기록 — 실제 Postgres 통합.
 *
 * 요약 칸과 목록 total 이 같은 정의인지, 좋은 손님·연체·미납 혜택의 경계가 SQL 에서 실제로 그어지는지는
 * 목(mock)으로는 증명되지 않는다. 다른 스펙과 같은 DB 를 쓰므로 요약은 «넣기 전후 차이»로 본다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { AdminMemberInsightsReader, MembershipInsights } from './admin-member-insights.reader';
import { AdminMembersReader } from './admin-members.reader';
import { ArrearsManager } from '../arrears/arrears.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
/** 오늘(한국 날짜) — 이번 달 안에 끝나는 자격을 만들 때 쓴다. */
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

describeIfDb('관리자 사람 축 요약·목록 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema.membershipSchema>>;
  let reader: AdminMemberInsightsReader;
  let membersReader: AdminMembersReader;
  let manager: ArrearsManager;
  let tierId: string;
  let monthlyPlanId: string;
  let annualPlanId: string;
  const run = Date.now().toString(36);
  const userIds: string[] = [];
  const u = (name: string) => {
    const id = `it-ins-${run}-${name}`;
    userIds.push(id);
    return id;
  };

  let before: MembershipInsights;
  let before2: { recurringCancelled: number };

  // 사람들
  const good = () => `it-ins-${run}-good`;
  const goodAnnual = () => `it-ins-${run}-good-annual`;
  let arrearsUser: string; // 웰컴딜 표가 uuid 라 uuid 로 만든다

  const contract = async (
    userId: string,
    opts: Partial<typeof schema.subscriptionContracts.$inferInsert> = {},
  ): Promise<string> => {
    const [row] = await db
      .insert(schema.subscriptionContracts)
      .values({ userId, planId: monthlyPlanId, billingDate: '2026-01-01', status: 'ACTIVE', ...opts })
      .returning({ id: schema.subscriptionContracts.id });
    return row.id;
  };
  const entitlement = (userId: string, endsAt: string) =>
    db
      .insert(schema.subscriptionEntitlement)
      .values({ userId, tierId, startsAt: '2026-01-01', endsAt, isCurrent: true });
  const charge = (contractId: string, eventType: 'CHARGE_SUCCESS' | 'CHARGE_FAIL', at: Date, amount: number | null) =>
    db.insert(schema.billingEvents).values({
      contractId,
      eventType,
      amount,
      paymentIntentId: `it-ins-${run}-${randomUUID()}`,
      createdAt: at,
    });
  /** 결제 성공 n번 — 첫 결제가 firstDaysAgo 일 전, 30일 간격. */
  const paidMonthly = async (contractId: string, n: number, firstDaysAgo: number, amount = 9900) => {
    for (let i = 0; i < n; i++) await charge(contractId, 'CHARGE_SUCCESS', daysAgo(firstDaysAgo - i * 30), amount);
  };
  const arrearsLine = (
    userId: string,
    contractId: string,
    amount: number,
    period: [string, string] | null,
    status: 'OUTSTANDING' | 'SETTLED' = 'OUTSTANDING',
  ) =>
    db
      .insert(schema.membershipArrears)
      .values({
        userId,
        contractId,
        invoiceRef: `it-ins-${run}-${randomUUID()}`,
        cause: period ? 'UNCOLLECTIBLE' : 'MANDATE_REJECTED',
        amount,
        periodStart: period?.[0] ?? null,
        periodEnd: period?.[1] ?? null,
        status,
        settledAt: status === 'SETTLED' ? new Date() : null,
      })
      .returning({ id: schema.membershipArrears.id });

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: schema.membershipSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t)),
    };
    reader = new AdminMemberInsightsReader(dbService as never);
    membersReader = new AdminMembersReader(dbService as never, {} as never, {} as never, {} as never);
    manager = new ArrearsManager(dbService as never);

    before = await reader.insights();
    before2 = await membersReader.countMembersByStatus();

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-ins-tier-${run}`, priorityLevel: 700000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [monthly] = await db.insert(schema.plan).values({ tierId, price: 9900, durationDays: 30 }).returning();
    monthlyPlanId = monthly.id;
    const [annual] = await db.insert(schema.plan).values({ tierId, price: 99000, durationDays: 365 }).returning();
    annualPlanId = annual.id;

    // ── 좋은 손님 후보 ──
    // 7번 결제, 첫 결제 200일 전 → 좋은 손님. 한 번 환불받아 순결제액은 6번 치.
    const cGood = await contract(u('good'), {
      billingPath: 'INVOICE',
      refundCompleted: true,
      eligibleRefundAmount: 9900,
    });
    await paidMonthly(cGood, 7, 200);
    // 연간 1번, 190일 전 → 좋은 손님, 결제액 1등
    const cAnnual = await contract(u('good-annual'), { planId: annualPlanId });
    await charge(cAnnual, 'CHARGE_SUCCESS', daysAgo(190), 99000);
    // 400일 전 실패는 12개월 밖 → 좋은 손님
    const cOldFail = await contract(u('old-fail'));
    await paidMonthly(cOldFail, 7, 200);
    await charge(cOldFail, 'CHARGE_FAIL', daysAgo(400), null);
    // 30일 전 실패 → 아님
    const cRecentFail = await contract(u('recent-fail'));
    await paidMonthly(cRecentFail, 7, 200);
    await charge(cRecentFail, 'CHARGE_FAIL', daysAgo(30), null);
    // 갚은 미납이라도 이력이 있으면 → 아님
    const cHist = await contract(u('arrears-history'));
    await paidMonthly(cHist, 7, 200);
    await arrearsLine(`it-ins-${run}-arrears-history`, cHist, 9900, ['2026-03-01', '2026-03-31'], 'SETTLED');
    // 첫 결제 40일 전 → 기간 부족, 아님
    const cShort = await contract(u('short'));
    await paidMonthly(cShort, 2, 40);
    // 결제 기록 없음(관리자 지급 등) → 판정 불가
    await contract(u('no-payment'));
    // 이용이 끝난 사람은 좋은 손님 후보가 아니다
    const cExpired = await contract(u('expired-payer'), { status: 'EXPIRED' });
    await paidMonthly(cExpired, 7, 250);

    // ── 연체(재시도 중) ──
    const cPd2 = await contract(u('pd-inv-2'), { billingPath: 'INVOICE', isPastDue: true });
    await db.insert(schema.subscriptionContractEvents).values([
      {
        contractId: cPd2,
        userId: `it-ins-${run}-pd-inv-2`,
        eventType: 'BILLING_FAILED',
        metadata: { attemptNo: 1 },
        causedBy: 'SYSTEM',
        createdAt: daysAgo(3),
      },
      {
        contractId: cPd2,
        userId: `it-ins-${run}-pd-inv-2`,
        eventType: 'BILLING_FAILED',
        metadata: { attemptNo: 2, errorCode: 'Q201' },
        causedBy: 'SYSTEM',
        createdAt: daysAgo(1),
      },
    ]);
    const cPd1 = await contract(u('pd-inv-1'), { billingPath: 'INVOICE', isPastDue: true });
    await db.insert(schema.subscriptionContractEvents).values({
      contractId: cPd1,
      userId: `it-ins-${run}-pd-inv-1`,
      eventType: 'BILLING_FAILED',
      metadata: { attemptNo: 1 },
      causedBy: 'SYSTEM',
      createdAt: daysAgo(2),
    });
    const cLegacy = await contract(u('pd-legacy'), { billingPath: 'CHARGE' });
    await db
      .insert(schema.membershipDunningQueue)
      .values({ contractId: cLegacy, attempts: 3, maxAttempts: 3, nextRetryAt: new Date(Date.now() + DAY) });
    // 끝난 계약의 잔재 표시는 세지 않는다
    await contract(u('pd-expired'), { billingPath: 'INVOICE', isPastDue: true, status: 'EXPIRED' });
    // 레거시 경로의 isPastDue 잔재값은 연체가 아니다(고객 화면과 같은 정의)
    await contract(u('pd-charge-flag'), { billingPath: 'CHARGE', isPastDue: true });

    // ── 미납 ──
    arrearsUser = randomUUID();
    userIds.push(arrearsUser);
    const cAr = await contract(arrearsUser, { status: 'EXPIRED', billingPath: 'INVOICE' });
    await arrearsLine(arrearsUser, cAr, 9900, ['2026-08-01', '2026-08-31']);
    await arrearsLine(arrearsUser, cAr, 9900, ['2026-09-01', '2026-09-30']);
    const discount = (orderDate: string, amount: number, isCancelled = false) =>
      db.insert(schema.membershipDiscountEvents).values({
        orderId: `it-ins-${run}-${randomUUID()}`,
        userId: arrearsUser,
        discountAmount: amount,
        tierId,
        cycleStartDate: '2026-08-01',
        subscriptionId: cAr,
        orderDate: new Date(orderDate),
        isCancelled,
      });
    await discount('2026-08-10T03:00:00Z', 1000);
    // 8/31 23:30 KST — 한국 날짜로는 기간 안
    await discount('2026-08-31T14:30:00Z', 300);
    // 10/1 00:30 KST — 기간 밖
    await discount('2026-09-30T15:30:00Z', 500);
    // 취소된 할인은 세지 않는다
    await discount('2026-08-12T03:00:00Z', 700, true);
    await db.insert(schema.welcomeMembershipEligibility).values({
      userId: arrearsUser,
      hasPurchased: true,
      purchaseSource: 'medusa',
      purchasedAt: new Date('2026-09-05T03:00:00Z'),
    });

    const cAr2 = await contract(u('arrears-2'), { status: 'EXPIRED' });
    await arrearsLine(`it-ins-${run}-arrears-2`, cAr2, 5000, null);
    // 30일 안의 납부 금액 불일치 1건 + 30일 밖 1건(세지 않는다)
    await db.insert(schema.subscriptionContractEvents).values([
      {
        contractId: cAr2,
        userId: `it-ins-${run}-arrears-2`,
        eventType: 'ARREARS_SETTLEMENT_MISMATCH',
        metadata: { reason: 'UNDERPAID', paid: 3000, due: 5000 },
        causedBy: 'SYSTEM',
        createdAt: daysAgo(2),
      },
      {
        contractId: cAr2,
        userId: `it-ins-${run}-arrears-2`,
        eventType: 'ARREARS_SETTLEMENT_MISMATCH',
        metadata: { reason: 'OVERPAID', paid: 9000, due: 5000 },
        causedBy: 'SYSTEM',
        createdAt: daysAgo(40),
      },
    ]);
    await arrearsLine(`it-ins-${run}-arrears-2`, cAr2, 9900, ['2026-07-01', '2026-07-31'], 'SETTLED');

    // ── 해지 예약 ──
    const endingUser = u('ending-soon');
    await contract(endingUser, { recurringCancelledAt: daysAgo(5), autoRenewal: false });
    await entitlement(endingUser, kstToday());
    const endingLater = u('ending-later');
    await contract(endingLater, { recurringCancelledAt: daysAgo(5), autoRenewal: false });
    await entitlement(endingLater, dateOnly(new Date(Date.now() + 60 * DAY)));
  });

  afterAll(async () => {
    try {
      if (userIds.length > 0) {
        const ids = client.array(userIds);
        await client`delete from membership_arrears_adjustments where user_id = any(${ids})`;
        await client`delete from membership_arrears where user_id = any(${ids})`;
        await client`delete from membership_discount_events where user_id = any(${ids})`;
        await client`delete from welcome_membership_eligibility where user_id::text = any(${ids})`;
        await client`delete from membership_dunning_queue where contract_id in (select id from subscription_contracts where user_id = any(${ids}))`;
        await client`delete from billing_events where contract_id in (select id from subscription_contracts where user_id = any(${ids}))`;
        await client`delete from subscription_contract_events where user_id = any(${ids})`;
        await client`delete from subscription_entitlement where user_id = any(${ids})`;
        await client`delete from subscription_contracts where user_id = any(${ids})`;
      }
      if (tierId) {
        await client`delete from plan where tier_id = ${tierId}::uuid`;
        await client`delete from tiers where id = ${tierId}::uuid`;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  describe('좋은 손님', () => {
    it('기간·실패·미납 이력 기준을 모두 넘은 이용 중인 사람만 들어온다', async () => {
      const page = await reader.goodPage(1, 50, userIds);
      expect(page.rows.map((r) => r.userId).sort()).toEqual([good(), goodAnnual(), `it-ins-${run}-old-fail`].sort());
      expect(page.total).toBe(3);
    });

    it('결제액은 환불을 뺀 값이고, 많이 낸 순서다', async () => {
      const page = await reader.goodPage(1, 50, userIds);
      expect(page.rows[0].userId).toBe(goodAnnual());
      expect(page.rows[0].detail.paidAmount).toBe(99000);
      const g = page.rows.find((r) => r.userId === good());
      expect(g?.detail.paidAmount).toBe(6 * 9900);
      expect(g?.detail.paidCount).toBe(7);
      expect(g?.detail.paidDays).toBe(210);
    });

    it('요약 칸의 증가분이 목록과 같고, 결제 기록 없는 사람은 판정 불가로 따로 센다', async () => {
      const after = await reader.insights();
      expect(after.good.people - before.good.people).toBe(3);
      // no-payment · pd-inv-2 · pd-inv-1 · pd-legacy · pd-charge-flag · ending-soon · ending-later
      expect(after.good.undeterminedPeople - before.good.undeterminedPeople).toBe(7);
      expect(after.good.paidAmount - before.good.paidAmount).toBe(99000 + 6 * 9900 + 7 * 9900);
      expect(after.good.criteria.minPaidDays).toBe(180);
    });
  });

  describe('출금 재시도 중', () => {
    it('이용 중 계약만, 남은 기회가 적은 순으로 나온다', async () => {
      const page = await reader.pastDuePage(1, 50, userIds);
      expect(page.rows.map((r) => r.userId)).toEqual([
        `it-ins-${run}-pd-inv-2`,
        `it-ins-${run}-pd-legacy`,
        `it-ins-${run}-pd-inv-1`,
      ]);
      expect(page.total).toBe(3);
    });

    it('인보이스는 마지막 실패 회차로, 옛 경로는 큐 횟수로 남은 기회를 센다', async () => {
      const page = await reader.pastDuePage(1, 50, userIds);
      const byUser = new Map(page.rows.map((r) => [r.userId, r.detail]));
      expect(byUser.get(`it-ins-${run}-pd-inv-2`)).toMatchObject({
        source: 'INVOICE',
        failedAttempts: 2,
        remainingAttempts: 1,
        lastErrorCode: 'Q201',
        amount: 9900,
      });
      expect(byUser.get(`it-ins-${run}-pd-inv-1`)).toMatchObject({ remainingAttempts: 2 });
      // attempts 가 한도(3)에 닿았어도 한 번 더 실패해야 끝난다
      expect(byUser.get(`it-ins-${run}-pd-legacy`)).toMatchObject({ source: 'LEGACY', remainingAttempts: 1 });
    });

    it('요약의 마지막 기회 인원은 남은 기회 1번인 사람이다', async () => {
      const after = await reader.insights();
      expect(after.pastDue.people - before.pastDue.people).toBe(3);
      expect(after.pastDue.lastChance - before.pastDue.lastChance).toBe(2);
      expect(after.pastDue.amountAtRisk - before.pastDue.amountAtRisk).toBe(3 * 9900);
    });
  });

  describe('미납 요금', () => {
    it('금액 큰 순이고, 기간 안(한국 날짜) 할인만 센다 — 취소분·기간 밖은 뺀다', async () => {
      const page = await reader.arrearsPage(1, 50, userIds);
      expect(page.rows.map((r) => r.userId)).toEqual([arrearsUser, `it-ins-${run}-arrears-2`]);
      expect(page.rows[0].detail).toMatchObject({
        outstandingAmount: 19800,
        lines: 2,
        periodStart: '2026-08-01',
        periodEnd: '2026-09-30',
        causes: ['UNCOLLECTIBLE'],
        benefit: { discountAmount: 1300, discountOrders: 2, welcomeDeal: true, unmeasuredLines: 0 },
        recentMismatches: 0,
      });
    });

    it('기간을 모르는 줄은 0원으로 적지 않고 «잴 수 없음»으로 센다', async () => {
      const page = await reader.arrearsPage(1, 50, userIds);
      const second = page.rows[1].detail;
      expect(second.outstandingAmount).toBe(5000);
      expect(second.benefit.unmeasuredLines).toBe(1);
      expect(second.recentMismatches).toBe(1);
    });

    it('요약: 남은 돈·사람·받아낸 돈', async () => {
      const after = await reader.insights();
      expect(after.arrears.outstandingAmount - before.arrears.outstandingAmount).toBe(24800);
      expect(after.arrears.outstandingPeople - before.arrears.outstandingPeople).toBe(2);
      expect(after.arrears.lifetime.settledAmount - before.arrears.lifetime.settledAmount).toBe(2 * 9900);
      expect(after.arrears.recentMismatches - before.arrears.recentMismatches).toBe(1);
    });

    it('상세: 줄마다 혜택과 기간을 모르는 줄을 구분한다', async () => {
      const extras = await reader.arrearsDetailExtras(`it-ins-${run}-arrears-2`);
      const measurable = extras.benefits.filter((b) => b.measurable);
      const unmeasurable = extras.benefits.filter((b) => !b.measurable);
      expect(measurable).toHaveLength(1);
      expect(unmeasurable).toHaveLength(1);
      expect(unmeasurable[0].discountAmount).toBe(0);
    });
  });

  describe('해지 예약', () => {
    it('요약 인원이 회원 목록의 해지 예약 수와 같은 정의다', async () => {
      const after = await reader.insights();
      const after2 = await membersReader.countMembersByStatus();
      expect(after.ending.people - before.ending.people).toBe(after2.recurringCancelled - before2.recurringCancelled);
      expect(after.ending.people - before.ending.people).toBe(2);
      expect(after.ending.endingWithin7Days - before.ending.endingWithin7Days).toBe(1);
    });

    it('끝나는 날이 가까운 순이다', async () => {
      const page = await reader.endingPage(1, 50, userIds);
      expect(page.rows.map((r) => r.userId)).toEqual([`it-ins-${run}-ending-soon`, `it-ins-${run}-ending-later`]);
    });
  });

  describe('면제·조정 기록', () => {
    it('두 번 조정해도 두 기록이 모두 남고, 원장의 청산 칸은 비어 있다', async () => {
      const [row] = await db
        .select()
        .from(schema.membershipArrears)
        .where(eq(schema.membershipArrears.userId, arrearsUser))
        .orderBy(schema.membershipArrears.periodStart)
        .limit(1);

      expect(await manager.adjustAmount(row.id, 5000, 'admin-a', '부분 입금 확인')).toBe(true);
      expect(await manager.adjustAmount(row.id, 4000, 'admin-b', '추가 입금 확인')).toBe(true);

      const extras = await reader.arrearsDetailExtras(arrearsUser);
      const history = extras.adjustments.filter((a) => a.arrearsId === row.id);
      expect(history.map((h) => [h.amountBefore, h.amountAfter, h.reason, h.adminId]).sort()).toEqual(
        [
          [9900, 5000, '부분 입금 확인', 'admin-a'],
          [5000, 4000, '추가 입금 확인', 'admin-b'],
        ].sort(),
      );

      const [after] = await db.select().from(schema.membershipArrears).where(eq(schema.membershipArrears.id, row.id));
      expect(after.amount).toBe(4000);
      expect(after.amountSource).toBe('ADMIN_ADJUSTED');
      // 조정은 청산이 아니다 — 뒤에 고객이 갚으면 「관리자가 청산」으로 보이면 안 된다.
      expect(after.settledBy).toBeNull();
      expect(after.settlementRef).toBeNull();
    });

    it('조정 뒤 고객이 갚으면 청산자 칸이 비어 있다', async () => {
      const [row] = await db
        .select()
        .from(schema.membershipArrears)
        .where(eq(schema.membershipArrears.userId, arrearsUser))
        .orderBy(schema.membershipArrears.periodStart)
        .limit(1);
      await db.transaction((tx) => manager.settleMany(tx as never, arrearsUser, [row.id], 'intent:it-ins'));
      const [after] = await db.select().from(schema.membershipArrears).where(eq(schema.membershipArrears.id, row.id));
      expect(after.status).toBe('SETTLED');
      expect(after.settledBy).toBeNull();
    });

    it('면제는 금액을 0 으로 적은 기록을 남기고, 닫힌 줄은 다시 면제되지 않는다', async () => {
      const [line] = await arrearsLine(
        arrearsUser,
        (
          await db
            .select({ id: schema.subscriptionContracts.id })
            .from(schema.subscriptionContracts)
            .where(eq(schema.subscriptionContracts.userId, arrearsUser))
        )[0].id,
        7000,
        ['2026-10-01', '2026-10-31'],
      );

      expect(await manager.waive(line.id, 'admin-c', '오판정')).toBe(true);
      expect(await manager.waive(line.id, 'admin-c', '두 번째')).toBe(false);

      const extras = await reader.arrearsDetailExtras(arrearsUser);
      const history = extras.adjustments.filter((a) => a.arrearsId === line.id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ action: 'WAIVE', amountBefore: 7000, amountAfter: 0, reason: '오판정' });
    });
  });
});
