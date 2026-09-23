/**
 * 가입 관문의 판정 — 실제 Postgres 통합.
 *
 * 관문이 미납 없는 고객을 막으면 그 자체가 가입 장애다. 목으로는 「청산·면제된 줄은 세지 않는다」가
 * 실제 조회 조건으로 지켜지는지 알 수 없으므로 실 DB 에서 고정한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다 — `npx jest` 기본 게이트에서는 돌지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { ArrearsManager } from './arrears.manager';
import { ArrearsReader } from './arrears.reader';
import { ArrearsGate } from './arrears.gate';
import { ArrearsOutstandingException } from '../../shared/exceptions/subscription.exceptions';
import * as schema from '../../shared/schemas/entities/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ArrearsGate 가입 관문 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let manager: ArrearsManager;
  let gate: ArrearsGate;
  let tierId: string;
  let planId: string;
  let contractId: string;
  const invoiceRefs: string[] = [];

  const newUserId = () => `it-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record = (userId: string) => {
    const invoiceRef = `it-gate-inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    invoiceRefs.push(invoiceRef);
    return db.transaction((tx) =>
      manager.record(tx as never, {
        userId,
        contractId,
        invoiceRef,
        cause: 'UNCOLLECTIBLE',
        causeCode: 'Q201',
        amount: 4990,
        currency: 'KRW',
        amountSource: 'INVOICE',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
      }),
    );
  };
  const outstandingIds = async (userId: string) => {
    const reader = new ArrearsReader({ db } as never);
    return (await reader.findOutstandingByUserId(userId)).map((r) => r.id);
  };

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    manager = new ArrearsManager({ db } as never);
    gate = new ArrearsGate(new ArrearsReader({ db } as never));

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-gate-tier-${Date.now()}`, priorityLevel: 700000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [planRow] = await db
      .insert(schema.plan)
      .values({ tierId, price: 4990, durationDays: 30, isActive: true })
      .returning();
    planId = planRow.id;
    const [contract] = await db
      .insert(schema.subscriptionContracts)
      .values({ userId: newUserId(), planId, status: 'CANCELLED', billingDate: '2026-08-01' })
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

  it('미납 기록이 없는 계정은 지나간다', async () => {
    await expect(gate.assertNoOutstanding(newUserId())).resolves.toBeUndefined();
  });

  it('미청산 줄이 있으면 막고, 청산하면 지나간다', async () => {
    const userId = newUserId();
    await record(userId);

    await expect(gate.assertNoOutstanding(userId)).rejects.toBeInstanceOf(ArrearsOutstandingException);

    const ids = await outstandingIds(userId);
    await db.transaction((tx) => manager.settleMany(tx as never, userId, ids, 'intent:it-gate'));

    await expect(gate.assertNoOutstanding(userId)).resolves.toBeUndefined();
  });

  it('관리자가 면제한 줄은 세지 않는다', async () => {
    const userId = newUserId();
    await record(userId);
    const [id] = await outstandingIds(userId);

    await manager.waive(id, 'admin-it', '오판정');

    await expect(gate.assertNoOutstanding(userId)).resolves.toBeUndefined();
  });

  it('남의 미납으로 막지 않는다', async () => {
    await record(newUserId());

    await expect(gate.assertNoOutstanding(newUserId())).resolves.toBeUndefined();
  });
});
