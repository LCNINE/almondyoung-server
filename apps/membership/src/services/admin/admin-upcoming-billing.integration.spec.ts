/**
 * 「다음 N일 청구 예정」 — 실제 Postgres 통합. 날짜 경계(오늘 포함·N일째 제외)와 계약 상태 필터를
 * 실제 조회 조건으로 고정한다. DB 에 다른 데이터가 있어도 되도록 넣기 전후의 차이로 판정한다.
 *
 * DATABASE_URL 이 없으면 통째로 skip 된다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { AdminMemberInsightsReader } from './admin-member-insights.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const kstDate = (now: Date, plusDays: number) =>
  new Date(now.getTime() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

describeIfDb('다음 N일 청구 예정 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema.membershipSchema>>;
  let reader: AdminMemberInsightsReader;
  let tierId: string;
  let planId: string;
  const contractIds: string[] = [];
  const run = Date.now().toString(36);
  const now = new Date();

  const contract = async (nextBillingDate: string, opts: Partial<typeof schema.subscriptionContracts.$inferInsert> = {}) => {
    const [row] = await db
      .insert(schema.subscriptionContracts)
      .values({
        userId: `it-upc-${run}-${contractIds.length}`,
        planId,
        billingDate: nextBillingDate,
        nextBillingDate,
        status: 'ACTIVE',
        ...opts,
      })
      .returning({ id: schema.subscriptionContracts.id });
    contractIds.push(row.id);
  };

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: schema.membershipSchema });
    reader = new AdminMemberInsightsReader({ db } as never);
    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: `it-upc-tier-${run}`, priorityLevel: 700000 + Math.floor(Math.random() * 90000) })
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

  it('오늘부터 7일(오늘 포함, 7일째 제외) 안에 결제일이 오는 자동갱신 계약만 센다', async () => {
    const before = await reader.upcomingBilling(7, now);

    await contract(kstDate(now, 0)); // 오늘 — 포함
    await contract(kstDate(now, 6)); // 6일 뒤 — 포함
    await contract(kstDate(now, 7)); // 7일 뒤 — 제외
    await contract(kstDate(now, -1)); // 어제 — 제외
    await contract(kstDate(now, 1), { autoRenewal: false }); // 해지 예약 — 제외
    await contract(kstDate(now, 1), { status: 'CANCELLED' }); // 해지 — 제외
    await contract(kstDate(now, 1), { isVoided: true }); // 무효 — 제외

    const after = await reader.upcomingBilling(7, now);

    expect(after.contracts - before.contracts).toBe(2);
    expect(after.amount - before.amount).toBe(2 * 4990);
    expect(after.from).toBe(kstDate(now, 0));
    expect(after.toExclusive).toBe(kstDate(now, 7));
  });
});
