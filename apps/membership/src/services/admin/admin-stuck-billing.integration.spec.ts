/**
 * 「선점 고착」 목록 — 실제 Postgres 통합. 기준 시각을 raw SQL 에 Date 로 넘기면 postgres.js 가 거절해
 * 목록이 통째로 500 이 됐다. 실제 드라이버로만 드러나므로 실 DB 에서 고정한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { AdminMembersReader } from './admin-members.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('선점 고착 목록 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema.membershipSchema>>;
  let reader: AdminMembersReader;
  let tierId: string;
  let planId: string;
  const contractIds: string[] = [];
  const run = Date.now().toString(36);

  const contract = async (billingStartedAt: Date, opts: Partial<typeof schema.subscriptionContracts.$inferInsert> = {}) => {
    const [row] = await db
      .insert(schema.subscriptionContracts)
      .values({
        userId: `it-stuck-${run}-${contractIds.length}`,
        planId,
        billingDate: '2026-09-01',
        status: 'ACTIVE',
        billingInProgress: true,
        billingStartedAt,
        ...opts,
      })
      .returning({ id: schema.subscriptionContracts.id });
    contractIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: schema.membershipSchema });
    reader = new AdminMembersReader({ db } as never, {} as never, {} as never, {} as never);
    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-stuck-tier-${run}`, priorityLevel: 700000 + Math.floor(Math.random() * 90000) })
      .returning();
    tierId = tier.id;
    const [plan] = await db.insert(schema.plan).values({ tierId, price: 4990, durationDays: 30 }).returning();
    planId = plan.id;
  });

  afterAll(async () => {
    try {
      if (contractIds.length > 0)
        await db.delete(schema.subscriptionContracts).where(inArray(schema.subscriptionContracts.id, contractIds));
      if (planId) await client`delete from plan where id = ${planId}::uuid`;
      if (tierId) await client`delete from tiers where id = ${tierId}::uuid`;
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('기준 시간보다 오래 선점된 계약만 돌려주고, 해지된 계약은 뺀다', async () => {
    const hours = (h: number) => new Date(Date.now() - h * 3600_000);
    const old = await contract(hours(72));
    const fresh = await contract(hours(1));
    const cancelled = await contract(hours(72), { status: 'CANCELLED' });

    const result = await reader.findStuckBillingContracts(48);
    const ids = result.data.map((row) => row.contractId);

    expect(ids).toContain(old);
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(cancelled);
    expect(result.data.find((row) => row.contractId === old)?.hoursElapsed).toBeGreaterThanOrEqual(71);
  });
});
