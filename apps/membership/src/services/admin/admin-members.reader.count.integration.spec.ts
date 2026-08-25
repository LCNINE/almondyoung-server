import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { AdminMembersReader, ADMIN_MEMBER_STATUS_FILTERS, AdminMemberStatusFilter } from './admin-members.reader';

/**
 * 요약 카운트 = 같은 status 필터의 목록 total 인지 실 Postgres 로 대조한다.
 *
 * 검증 대상이 distinct-on subquery 의 재사용 자체라 DB 를 목으로 두면 아무것도 확인하지
 * 못한다. 두 값 모두 전역 카운트이므로 DB 에 다른 데이터가 있어도 등식은 성립해야 한다 —
 * 시드는 각 상태 버킷이 0 이 아니게 만들기 위해서만 필요하다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/membership \
 *   npx jest --testPathPattern="admin-members.reader.count.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// CI 등 DB 가 반드시 있어야 하는 경로에서는 REQUIRE_MEMBERSHIP_DB=1 로 누락을 실패시킨다.
if (process.env.REQUIRE_MEMBERSHIP_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_MEMBERSHIP_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('멤버십 상태별 카운트는 목록 total 과 같은 정의를 쓴다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const marker = `itest-${randomUUID().slice(0, 8)}`;
  let sql: postgres.Sql;
  let reader: AdminMembersReader;
  let db: ReturnType<typeof drizzle<typeof membershipSchema>>;
  let tierId: string;
  let planId: string;
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: membershipSchema });

    const dbService = { db } as unknown as DbService<typeof membershipSchema>;
    // countMembersByStatus / findAllWithDetails 는 협력자를 쓰지 않는다.
    reader = new AdminMembersReader(dbService, {} as never, {} as never, {} as never);

    const [tier] = await db
      .insert(schema.tiers)
      .values({ code: marker, priorityLevel: 100000 + Math.floor(Math.random() * 800000) })
      .returning({ id: schema.tiers.id });
    tierId = tier.id;
    const [planRow] = await db
      .insert(schema.plan)
      .values({ tierId, price: 10000, durationDays: 30 })
      .returning({ id: schema.plan.id });
    planId = planRow.id;

    const today = new Date().toISOString().slice(0, 10);
    const seedContract = async (opts: {
      status: string;
      pausedAt?: Date;
      recurringCancelledAt?: Date;
      cancelledAt?: Date;
    }) => {
      const userId = `${marker}-${randomUUID().slice(0, 8)}`;
      seededUserIds.push(userId);
      await db.insert(schema.subscriptionContracts).values({
        userId,
        planId,
        billingDate: today,
        status: opts.status,
        cancelledAt: opts.cancelledAt ?? null,
        recurringCancelledAt: opts.recurringCancelledAt ?? null,
      });
      await db.insert(schema.subscriptionEntitlement).values({
        userId,
        tierId,
        startsAt: today,
        endsAt: today,
        isCurrent: true,
        pausedAt: opts.pausedAt ?? null,
      });
      return userId;
    };

    await seedContract({ status: 'ACTIVE' });
    await seedContract({ status: 'ACTIVE', pausedAt: new Date() });
    await seedContract({ status: 'ACTIVE', recurringCancelledAt: new Date() }); // 해지 예약
    await seedContract({ status: 'CANCELLED', cancelledAt: new Date() });
    await seedContract({ status: 'EXPIRED' });
    await seedContract({ status: 'EXPIRED', recurringCancelledAt: new Date() }); // 해지 예약 후 종료
  });

  afterAll(async () => {
    if (db && seededUserIds.length > 0) {
      await db
        .delete(schema.subscriptionEntitlement)
        .where(inArray(schema.subscriptionEntitlement.userId, seededUserIds));
      await db
        .delete(schema.subscriptionContracts)
        .where(inArray(schema.subscriptionContracts.userId, seededUserIds));
      await db.delete(schema.plan).where(eq(schema.plan.id, planId));
      await db.delete(schema.tiers).where(eq(schema.tiers.id, tierId));
    }
    await sql?.end();
  });

  it('버킷별 카운트가 같은 필터의 목록 total 과 일치한다', async () => {
    const summary = await reader.countMembersByStatus();

    const totalFor = async (status?: AdminMemberStatusFilter) => {
      const { total } = await reader.findAllWithDetails({ page: 1, limit: 1, status });
      return total;
    };

    expect(summary.total).toBe(await totalFor(undefined));
    expect(summary.active).toBe(await totalFor('ACTIVE'));
    expect(summary.paused).toBe(await totalFor('PAUSED'));
    expect(summary.recurringCancelled).toBe(await totalFor('RECURRING_CANCELLED'));
    expect(summary.cancelled).toBe(await totalFor('CANCELLED'));
    expect(summary.expired).toBe(await totalFor('EXPIRED'));

    // 시드가 실제로 각 버킷에 최소 1건씩 반영됐는지 — 0=0 등식으로 통과하는 빈 검증 방지.
    expect(summary.active).toBeGreaterThanOrEqual(2); // ACTIVE + 해지예약(ACTIVE 유지)
    expect(summary.paused).toBeGreaterThanOrEqual(1);
    expect(summary.recurringCancelled).toBeGreaterThanOrEqual(1);
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(summary.expired).toBeGreaterThanOrEqual(2);
  });

  it('해지 예약(잔여기간 이용 중) 회원은 active 에 포함되고 recurringCancelled 에도 집계된다', async () => {
    const summary = await reader.countMembersByStatus();
    const recurring = await reader.findAllWithDetails({ page: 1, limit: 50, status: 'RECURRING_CANCELLED' });

    const seededRecurring = recurring.data.filter((row) => row.userId.startsWith(marker));
    expect(seededRecurring).toHaveLength(1);
    // 같은 회원이 ACTIVE 필터에서도 나온다 — 서버 status 는 ACTIVE.
    const active = await reader.findAllWithDetails({ page: 1, limit: 50, status: 'ACTIVE', q: seededRecurring[0].userId });
    expect(active.total).toBe(1);
    expect(summary.recurringCancelled).toBeLessThanOrEqual(summary.active);
  });

  it('알 수 없는 상태 필터는 명시적으로 거부된다', async () => {
    await expect(
      reader.findAllWithDetails({ page: 1, limit: 1, status: 'BOGUS' as (typeof ADMIN_MEMBER_STATUS_FILTERS)[number] }),
    ).rejects.toThrow('알 수 없는 상태 필터');
  });
});
