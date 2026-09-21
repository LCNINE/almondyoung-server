/**
 * 미수 원장의 멱등·청산 — 실제 Postgres 통합.
 *
 * 유닛 스펙은 tx 목이라 `onConflictDoNothing` 과 `WHERE status='OUTSTANDING'` 이 **실제 제약으로**
 * 막는지를 증명하지 못한다. 목은 시킨 대로 답할 뿐이라 유니크 인덱스가 없어도 초록이다.
 * 여기서는 마이그레이션이 적용된 실 DB 에 붙어 ①같은 인보이스 두 번 → 1행 ②같은 결제 두 번 →
 * 두 번째는 0건 ③남의 줄은 안 닫힌다 를 고정한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { ArrearsManager } from './arrears.manager';
import * as schema from '../../shared/schemas/entities/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ArrearsManager 원장 멱등·청산 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let manager: ArrearsManager;
  let tierId: string;
  let planId: string;
  let contractId: string;
  const userIds: string[] = [];
  const invoiceRefs: string[] = [];

  const newUserId = () => {
    const id = `it-arrears-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    userIds.push(id);
    return id;
  };
  const newInvoiceRef = () => {
    const ref = `it-arrears-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    invoiceRefs.push(ref);
    return ref;
  };

  const recordInput = (userId: string, invoiceRef: string, amount = 4990) => ({
    userId,
    contractId,
    invoiceRef,
    cause: 'UNCOLLECTIBLE' as const,
    causeCode: 'Q201',
    amount,
    currency: 'KRW',
    amountSource: 'INVOICE' as const,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
  });

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    manager = new ArrearsManager({ db } as never);

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-arrears-tier-${Date.now()}`, priorityLevel: 800000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [planRow] = await db
      .insert(schema.plan)
      .values({ tierId, price: 4990, durationDays: 30, isActive: true })
      .returning();
    planId = planRow.id;
    const [contract] = await db
      .insert(schema.subscriptionContracts)
      .values({ userId: newUserId(), planId, status: 'ACTIVE', billingDate: '2026-08-01' })
      .returning();
    contractId = contract.id;
  });

  afterAll(async () => {
    try {
      if (invoiceRefs.length > 0) {
        await client`delete from membership_arrears where invoice_ref = any(${client.array(invoiceRefs)})`;
      }
      if (contractId) await client`delete from subscription_contracts where id = ${contractId}::uuid`;
      if (planId) await client`delete from plan where id = ${planId}::uuid`;
      if (tierId) await client`delete from tiers where id = ${tierId}::uuid`;
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('같은 인보이스가 두 번 와도 원장은 한 줄이다', async () => {
    const userId = newUserId();
    const invoiceRef = newInvoiceRef();

    const first = await db.transaction((tx) => manager.record(tx as never, recordInput(userId, invoiceRef)));
    const second = await db.transaction((tx) => manager.record(tx as never, recordInput(userId, invoiceRef)));

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('한 결제가 여러 줄을 한 번에 닫고, 같은 결제가 다시 와도 두 번째는 0건이다', async () => {
    const userId = newUserId();
    const refA = newInvoiceRef();
    const refB = newInvoiceRef();

    await db.transaction((tx) => manager.record(tx as never, recordInput(userId, refA, 4990)));
    await db.transaction((tx) => manager.record(tx as never, recordInput(userId, refB, 5000)));

    const outstandingBefore = await db.transaction((tx) => manager.outstandingTotal(tx as never, userId));
    expect(outstandingBefore).toBe(9990);

    const ids = (
      await db.select().from(schema.membershipArrears).where(eq(schema.membershipArrears.userId, userId))
    ).map((r) => r.id);

    const settled = await db.transaction((tx) => manager.settleMany(tx as never, userId, ids, 'intent:it-1'));
    expect(settled.sort()).toEqual(ids.sort());

    const again = await db.transaction((tx) => manager.settleMany(tx as never, userId, ids, 'intent:it-1'));
    expect(again).toEqual([]);

    const outstandingAfter = await db.transaction((tx) => manager.outstandingTotal(tx as never, userId));
    expect(outstandingAfter).toBe(0);

    const rows = await db
      .select()
      .from(schema.membershipArrears)
      .where(and(eq(schema.membershipArrears.userId, userId), eq(schema.membershipArrears.status, 'SETTLED')));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.settlementRef === 'intent:it-1' && r.settledAt !== null)).toBe(true);
  });

  it('다른 사람의 미수는 id 를 알아도 닫히지 않는다', async () => {
    const owner = newUserId();
    const other = newUserId();
    const ref = newInvoiceRef();

    await db.transaction((tx) => manager.record(tx as never, recordInput(owner, ref)));
    const [row] = await db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.userId, owner));

    const settled = await db.transaction((tx) => manager.settleMany(tx as never, other, [row.id], 'intent:it-2'));
    expect(settled).toEqual([]);

    const [after] = await db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.id, row.id));
    expect(after.status).toBe('OUTSTANDING');
  });

  it('면제된 줄은 결제가 와도 다시 닫히지 않는다', async () => {
    const userId = newUserId();
    const ref = newInvoiceRef();

    await db.transaction((tx) => manager.record(tx as never, recordInput(userId, ref)));
    const [row] = await db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.userId, userId));

    expect(await manager.waive(row.id, 'admin-it', '오판정 면제')).toBe(true);

    const settled = await db.transaction((tx) => manager.settleMany(tx as never, userId, [row.id], 'intent:it-3'));
    expect(settled).toEqual([]);

    const [after] = await db
      .select()
      .from(schema.membershipArrears)
      .where(eq(schema.membershipArrears.id, row.id));
    expect(after.status).toBe('WAIVED');
  });
});
