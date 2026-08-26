import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  aggCustomerLifetime,
  aggUserProductPurchase,
  analyticsSchema,
  dimCustomerMembership,
  dimProductMasters,
  factOrderItems,
} from '../../../schema';
import { CustomerInsightsQuery } from './customer-insights.query';

/**
 * 고객 분석 read-model 을 실 Postgres 로 검증한다. 코호트·등급 전환은 2030년 날짜로
 * 시드해 로컬 실데이터(2025~26)와 겹치지 않게 격리한다. RFM·재구매는 전 고객 스캔이라
 * 완전 격리가 불가능하므로, 시드가 만든 행/셀의 존재만 단언한다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="customer-insights.query.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CustomerInsightsQuery (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const channel = `itest-${randomUUID().slice(0, 8)}`;
  const masterR = `itest-master-${randomUUID().slice(0, 8)}`;
  const tierA = `itest-tier-a-${randomUUID().slice(0, 8)}`;
  const tierB = `itest-tier-b-${randomUUID().slice(0, 8)}`;
  const u1 = `itest-user-${randomUUID().slice(0, 8)}`;
  const u2 = `itest-user-${randomUUID().slice(0, 8)}`;
  const u3 = `itest-user-${randomUUID().slice(0, 8)}`;
  const u4 = `itest-user-${randomUUID().slice(0, 8)}`;
  const uT = `itest-user-${randomUUID().slice(0, 8)}`;
  const allUsers = [u1, u2, u3, u4, uT];

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let query: CustomerInsightsQuery;

  const messageId = () => `IT${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const factRow = (customerId: string, occurredAt: string) => ({
    messageId: messageId(),
    orderKey: `${customerId}-${occurredAt}`,
    salesChannel: channel,
    customerId,
    masterId: masterR,
    quantity: 1,
    occurredAt: new Date(`${occurredAt}T10:00:00+09:00`),
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    query = new CustomerInsightsQuery(dbService);

    // 코호트: 2030-06 첫구매 2명(u1·u2), 2030-07 첫구매 1명(u3).
    // u1 은 8월에 재구매, u2 는 무소식, u3 은 8월에 재구매.
    await db.insert(aggCustomerLifetime).values([
      { customerId: u1, firstOrderAt: new Date('2030-06-05T10:00:00+09:00'), lastOrderAt: new Date('2030-08-04T10:00:00+09:00'), ordersCount: 3, totalRevenue: 50000 },
      { customerId: u2, firstOrderAt: new Date('2030-06-20T10:00:00+09:00'), lastOrderAt: new Date('2030-06-20T10:00:00+09:00'), ordersCount: 1, totalRevenue: 10000 },
      { customerId: u3, firstOrderAt: new Date('2030-07-02T10:00:00+09:00'), lastOrderAt: new Date('2030-08-10T10:00:00+09:00'), ordersCount: 2, totalRevenue: 30000 },
      // RFM 휴면 검증용 — 마지막 주문이 아주 오래됐고 주문수가 많다.
      { customerId: u4, firstOrderAt: new Date('2019-01-05T10:00:00+09:00'), lastOrderAt: new Date('2019-06-05T10:00:00+09:00'), ordersCount: 12, totalRevenue: 990000 },
    ]);
    await db.insert(factOrderItems).values([
      factRow(u1, '2030-06-05'),
      factRow(u1, '2030-06-21'),
      factRow(u1, '2030-08-04'),
      factRow(u2, '2030-06-20'),
      factRow(u3, '2030-07-02'),
      factRow(u3, '2030-08-10'),
    ]);

    // 재구매: masterR 구매자 3명 중 2명이 재구매. 주기 평균 = (60/2 + 20/1) / 2 = 25일.
    await db.insert(dimProductMasters).values([{ masterId: masterR, name: '통합테스트 재구매 상품', isActive: true }]);
    await db.insert(aggUserProductPurchase).values([
      { customerId: u1, masterId: masterR, purchaseCount: 3, totalQuantity: 3, firstPurchasedAt: new Date('2030-06-05T10:00:00+09:00'), lastPurchasedAt: new Date('2030-08-04T10:00:00+09:00') },
      { customerId: u2, masterId: masterR, purchaseCount: 1, totalQuantity: 1, firstPurchasedAt: new Date('2030-06-20T10:00:00+09:00'), lastPurchasedAt: new Date('2030-06-20T10:00:00+09:00') },
      { customerId: u3, masterId: masterR, purchaseCount: 2, totalQuantity: 2, firstPurchasedAt: new Date('2030-07-02T10:00:00+09:00'), lastPurchasedAt: new Date('2030-07-22T10:00:00+09:00') },
    ]);

    // 등급 전환: uT 가 8월 5일 tierA → tierB. tierB 구간은 열려 있다(현재 등급).
    await db.insert(dimCustomerMembership).values([
      { userId: uT, tierId: tierA, validFrom: new Date('2030-07-01T00:00:00+09:00'), validTo: new Date('2030-08-05T00:00:00+09:00') },
      { userId: uT, tierId: tierB, validFrom: new Date('2030-08-05T00:00:00+09:00'), validTo: null },
    ]);
  });

  afterAll(async () => {
    await db.delete(factOrderItems).where(eq(factOrderItems.salesChannel, channel));
    await db.delete(aggCustomerLifetime).where(inArray(aggCustomerLifetime.customerId, allUsers));
    await db.delete(aggUserProductPurchase).where(eq(aggUserProductPurchase.masterId, masterR));
    await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterR));
    await db.delete(dimCustomerMembership).where(eq(dimCustomerMembership.userId, uT));
    await sql.end();
  });

  it('코호트 매트릭스 — 크기·리텐션·미래 칸 null', async () => {
    const result = await query.getInsights('2030-08-01', '2030-08-31');

    const june = result.cohorts.rows.find((row) => row.cohortMonth === '2030-06');
    expect(june).toBeDefined();
    expect(june?.size).toBe(2);
    // +0: 둘 다 6월에 주문 → 1. +1(7월): 아무도 없음 → 0. +2(8월): u1 만 → 0.5.
    expect(june?.retention.slice(0, 3)).toEqual([1, 0, 0.5]);
    // 2030-09 이후는 아직 오지 않았다.
    expect(june?.retention[3]).toBeNull();

    const july = result.cohorts.rows.find((row) => row.cohortMonth === '2030-07');
    expect(july?.size).toBe(1);
    expect(july?.retention.slice(0, 2)).toEqual([1, 1]);
  });

  it('RFM — 휴면 셀과 세그먼트에 시드 고객이 잡히고 셀 합 = 전체', async () => {
    const result = await query.getInsights('2030-08-01', '2030-08-31');

    const dormantCell = result.rfm.cells.find(
      (cell) => cell.recency === '1년 이상' && cell.frequency === '10회 이상',
    );
    expect(dormantCell?.customers ?? 0).toBeGreaterThanOrEqual(1);

    const dormantSegment = result.rfm.segments.find((segment) => segment.key === 'dormant');
    expect(dormantSegment?.customers ?? 0).toBeGreaterThanOrEqual(1);

    const cellSum = result.rfm.cells.reduce((sum, cell) => sum + cell.customers, 0);
    const segmentSum = result.rfm.segments.reduce((sum, segment) => sum + segment.customers, 0);
    expect(cellSum).toBe(result.rfm.totalCustomers);
    expect(segmentSum).toBe(result.rfm.totalCustomers);
  });

  it('상품별 재구매 — 구매자·재구매율·평균 주기', async () => {
    const result = await query.getInsights('2030-08-01', '2030-08-31', 200, 3);

    const item = result.repurchase.items.find((row) => row.masterId === masterR);
    expect(item).toBeDefined();
    expect(item?.name).toBe('통합테스트 재구매 상품');
    expect(item?.buyers).toBe(3);
    expect(item?.repeatBuyers).toBe(2);
    expect(item?.repurchaseRate).toBeCloseTo(2 / 3, 5);
    expect(item?.avgCycleDays).toBeCloseTo(25, 1);
  });

  it('등급 전환 — 기간 내 전환 1건과 현재 분포', async () => {
    const result = await query.getInsights('2030-08-01', '2030-08-31');

    const transition = result.tierFlow.transitions.find(
      (row) => row.fromTier === tierA && row.toTier === tierB,
    );
    expect(transition?.count).toBe(1);

    const current = result.tierFlow.currentDistribution.find((row) => row.tierId === tierB);
    expect(current?.count ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('기간 밖에서는 등급 전환이 잡히지 않는다', async () => {
    const result = await query.getInsights('2030-07-01', '2030-07-31');
    const transition = result.tierFlow.transitions.find(
      (row) => row.fromTier === tierA && row.toTier === tierB,
    );
    expect(transition).toBeUndefined();
  });
});
