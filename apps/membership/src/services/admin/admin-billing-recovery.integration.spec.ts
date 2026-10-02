/**
 * 출금 실패·미납 현황 — 실제 Postgres 통합.
 *
 * 건은 «같은 트랜잭션에서 적힌 사건은 created_at 이 같다»는 성질로 잇는다(실패↔회차 알림, 해지↔미납 줄·해지 안내).
 * 그 이음이 SQL 에서 실제로 맞는지는 목(mock)으로 증명되지 않는다. 운영 코드가 한 트랜잭션에서 적는 사건은
 * 여기서도 같은 시각으로 넣는다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../shared/schemas/entities/schema';
import { AdminBillingRecoveryReader, kstMonthOf } from './admin-billing-recovery.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const HOUR = 3600_000;
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR);

describeIfDb('출금 실패·미납 현황 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema.membershipSchema>>;
  let reader: AdminBillingRecoveryReader;
  let tierId: string;
  let planId: string;
  const run = Date.now().toString(36);
  const userIds: string[] = [];
  const u = (name: string) => {
    const id = `it-rec-${run}-${name}`;
    userIds.push(id);
    return id;
  };

  const recovered = u('recovered');
  const exhausted = u('exhausted');
  const mandate = u('mandate');
  const retrying = u('retrying');
  const legacy = u('legacy');
  const twice = u('twice');

  const contract = async (userId: string, opts: Partial<typeof schema.subscriptionContracts.$inferInsert> = {}) => {
    const [row] = await db
      .insert(schema.subscriptionContracts)
      .values({ userId, planId, billingDate: '2026-01-01', status: 'ACTIVE', billingPath: 'INVOICE', ...opts })
      .returning({ id: schema.subscriptionContracts.id });
    return row.id;
  };
  const event = (contractId: string, userId: string, eventType: string, metadata: Record<string, unknown>, at: Date) =>
    db
      .insert(schema.subscriptionContractEvents)
      .values({ contractId, userId, eventType, metadata, causedBy: 'SYSTEM', createdAt: at });
  /** 실패 한 번 + 그 트랜잭션의 회차 알림 기록 */
  const fail = async (
    contractId: string,
    userId: string,
    invoiceId: string,
    attemptNo: number,
    at: Date,
    notice: 'QUEUED' | 'SKIPPED' | null,
    extra: Record<string, unknown> = {},
  ) => {
    await event(contractId, userId, 'BILLING_FAILED', { invoiceId, attemptNo, errorCode: 'Q201', ...extra }, at);
    await db.insert(schema.billingEvents).values({
      contractId,
      eventType: 'CHARGE_FAIL',
      paymentIntentId: `${invoiceId}:attempt:${attemptNo}`,
      errorCode: 'Q201',
      errorMessage: `  잔액   부족 ${attemptNo}`,
      createdAt: at,
    });
    if (notice === 'QUEUED')
      await event(
        contractId,
        userId,
        'BILLING_NOTICE_QUEUED',
        { kind: 'ATTEMPT_FAILED', channel: 'KAKAO', attemptNo },
        at,
      );
    if (notice === 'SKIPPED')
      await event(contractId, userId, 'BILLING_NOTICE_SKIPPED', { kind: 'ATTEMPT_FAILED', reason: 'NO_PHONE' }, at);
  };

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: schema.membershipSchema });
    // 정책 시행일을 모르는 환경(null) — 경계 없이 전부 시행 후로 본다
    reader = new AdminBillingRecoveryReader({ db } as never, { existingMembersEffectiveAt: () => null } as never);

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-rec-tier-${run}`, priorityLevel: 800000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [plan] = await db.insert(schema.plan).values({ tierId, price: 4990, durationDays: 30 }).returning();
    planId = plan.id;

    // ① 1회 실패 뒤 재시도로 회수
    const c1 = await contract(recovered);
    await fail(c1, recovered, `inv-${run}-1`, 1, hoursAgo(50), 'QUEUED');
    await event(c1, recovered, 'BILLING_SUCCESS', { invoiceId: `inv-${run}-1`, amount: 4990 }, hoursAgo(2));

    // ② 3번 실패 → 해지 + 미납(납부 진행 중) + 해지 안내
    const c2 = await contract(exhausted, { status: 'CANCELLED' });
    await fail(c2, exhausted, `inv-${run}-2`, 1, hoursAgo(100), 'QUEUED');
    await fail(c2, exhausted, `inv-${run}-2`, 2, hoursAgo(52), 'SKIPPED');
    await fail(c2, exhausted, `inv-${run}-2`, 3, hoursAgo(4), null);
    const t2 = hoursAgo(4);
    await event(c2, exhausted, 'TERMINATED', { reason: 'UNCOLLECTIBLE:Q301' }, t2);
    await db.insert(schema.membershipArrears).values({
      userId: exhausted,
      contractId: c2,
      invoiceRef: `inv-${run}-2`,
      cause: 'UNCOLLECTIBLE',
      amount: 4990,
      pendingIntentId: `pi-${run}`,
      createdAt: t2,
    });
    await event(c2, exhausted, 'ARREARS_RECORDED', { invoiceRef: `inv-${run}-2`, amount: 4990 }, t2);
    await event(
      c2,
      exhausted,
      'BILLING_NOTICE_QUEUED',
      { kind: 'TERMINATED', channel: 'KAKAO', withArrears: true },
      t2,
    );

    // ③ 출금 전 계좌 거절 해지 — 청약철회 대상이라 미납 안 적음
    const c3 = await contract(mandate, { status: 'CANCELLED' });
    const t3 = hoursAgo(6);
    await event(c3, mandate, 'TERMINATED', { reason: 'MANDATE_REJECTED:MANDATE_TIMEOUT' }, t3);
    await event(
      c3,
      mandate,
      'ARREARS_SKIPPED',
      { invoiceRef: `mandate-rejected:${c3}`, reason: 'WITHDRAWAL_ELIGIBLE' },
      t3,
    );
    await event(c3, mandate, 'BILLING_NOTICE_SKIPPED', { kind: 'TERMINATED', reason: 'NO_PHONE' }, t3);

    // ④ 2번 실패, 재시도 중(마지막 기회). 1회차는 알림 기록이 없다(기능 이전)
    const c4 = await contract(retrying, { isPastDue: true });
    const next = new Date(Date.now() + 40 * HOUR).toISOString();
    await fail(c4, retrying, `inv-${run}-4`, 1, hoursAgo(60), null);
    await fail(c4, retrying, `inv-${run}-4`, 2, hoursAgo(8), 'QUEUED', { nextAttemptAt: next });

    // ⑤ 옛 경로 실패(인보이스 id 없음) — 건이 아니다
    const c5 = await contract(legacy, { billingPath: 'CHARGE', isPastDue: true });
    await event(c5, legacy, 'BILLING_FAILED', { attemptNo: 1, errorCode: 'E' }, hoursAgo(3));

    // ⑥ 한 계약에서 지난달 실패는 회수, 이번 실패는 진행 중 → 건 두 개
    const c6 = await contract(twice, { isPastDue: true });
    await fail(c6, twice, `inv-${run}-6a`, 1, hoursAgo(24 * 30), null);
    await event(c6, twice, 'BILLING_SUCCESS', { invoiceId: `inv-${run}-6a`, amount: 4990 }, hoursAgo(24 * 28));
    await fail(c6, twice, `inv-${run}-6b`, 1, hoursAgo(1), 'QUEUED');
  });

  afterAll(async () => {
    try {
      if (userIds.length > 0) {
        const ids = client.array(userIds);
        await client`delete from membership_arrears where user_id = any(${ids})`;
        await client`delete from billing_events where contract_id in (select id from subscription_contracts where user_id = any(${ids}))`;
        await client`delete from subscription_contract_events where user_id = any(${ids})`;
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

  const only = async (userId: string) => {
    const { cases } = await reader.journey(userId);
    expect(cases).toHaveLength(1);
    return cases[0];
  };

  it('재시도 성공 건: 회수 금액과 1회차 알림 접수가 이어진다', async () => {
    const c = await only(recovered);
    expect(c).toMatchObject({ stage: 'RECOVERED', recoveredAmount: 4990, attempts: 1 });
    expect(c.attemptNotices).toEqual([{ attemptNo: 1, state: 'QUEUED', reason: null }]);
  });

  it('재시도 소진 건: 미납 줄·해지 안내가 같은 트랜잭션 시각으로 이어지고, 건너뛴 회차는 이유까지', async () => {
    const c = await only(exhausted);
    expect(c).toMatchObject({ stage: 'TERMINATED', terminationKind: 'EXHAUSTED', debtState: 'PAYING', attempts: 3 });
    expect(c.arrears).toMatchObject({ amount: 4990, status: 'OUTSTANDING', paying: true });
    expect(c.attemptNotices).toEqual([
      { attemptNo: 1, state: 'QUEUED', reason: null },
      { attemptNo: 2, state: 'SKIPPED', reason: 'NO_PHONE' },
    ]);
    expect(c.attemptNoticesMissing).toEqual([]);
    expect(c.finalNotice).toEqual({ state: 'QUEUED', reason: null });
    expect(c.failures.map((x) => x.attemptNo)).toEqual([1, 2, 3]);
  });

  it('계좌 거절 건: 출금 시도 없이 해지, 미납 안 적은 이유와 해지 안내 건너뜀이 붙는다', async () => {
    const c = await only(mandate);
    expect(c).toMatchObject({
      kind: 'MANDATE',
      terminationKind: 'MANDATE_REJECTED',
      debtState: 'NOT_RECORDED',
      arrearsSkippedReason: 'WITHDRAWAL_ELIGIBLE',
      lastErrorCode: 'MANDATE_TIMEOUT',
    });
    expect(c.finalNotice).toEqual({ state: 'SKIPPED', reason: 'NO_PHONE' });
  });

  it('재시도 중 건: 기록된 다음 출금 시각, 알림 기록 없는 1회차', async () => {
    const c = await only(retrying);
    expect(c).toMatchObject({ stage: 'RETRYING', attempts: 2, remainingAttempts: 1 });
    expect(c.nextAttempt?.estimated).toBe(false);
    expect(c.attemptNoticesMissing).toEqual([1]);
    expect(c.lastErrorMessage).toBe('잔액 부족 2');
  });

  it('옛 경로 실패는 건으로 세지 않는다', async () => {
    expect((await reader.journey(legacy)).cases).toEqual([]);
  });

  it('한 계약의 인보이스마다 건이 따로 생긴다', async () => {
    const { cases } = await reader.journey(twice);
    expect(cases.map((c) => [c.invoiceId, c.stage])).toEqual([
      [`inv-${run}-6b`, 'RETRYING'],
      [`inv-${run}-6a`, 'RECOVERED'],
    ]);
  });

  it('현황: 보드 칸과 경보가 같은 판정을 쓴다', async () => {
    const o = await reader.overview(kstMonthOf(new Date()));
    const ids = (cards: Array<{ userId: string }>) =>
      cards.map((c) => c.userId).filter((id) => id.startsWith(`it-rec-${run}`));
    // 다른 스펙의 행이 섞일 수 있어 이 실행의 사람만 본다
    expect(ids(o.now.lanes.lastChance.cards)).toEqual([retrying]);
    expect(ids(o.now.lanes.firstFailure.cards)).toEqual([twice]);
    expect(ids(o.now.lanes.outstanding.cards)).toEqual([exhausted]);
    expect(o.now.lanes.outstanding.cards.find((c) => c.userId === exhausted)).toMatchObject({
      amount: 4990,
      paying: true,
      finalNotice: { state: 'QUEUED', reason: null },
    });
    // 최근 30일 해결: 2시간 전 회수, 28일 전 회수(⑥의 지난 인보이스) — 최근 순
    expect(ids(o.now.lanes.resolved.cards)).toEqual([recovered, twice]);
    expect(o.now.alerts.lastChance.userIds).toContain(retrying);
    expect(o.now.alerts.paying.userIds).toContain(exhausted);
    expect(o.now.alerts.noticeSkipped.userIds).toEqual(expect.arrayContaining([exhausted, mandate]));
  });
});
