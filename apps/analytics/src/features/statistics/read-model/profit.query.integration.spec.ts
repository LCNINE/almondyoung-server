import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { aggProductOrderDaily, analyticsSchema, dimProductMasters, factOrderItems } from '../../../schema';
import { ProfitQuery } from './profit.query';

/**
 * 이익 read-model 을 실 Postgres 로 검증한다 — 검증 대상이 SQL(그룹핑·서브쿼리·FILTER) 자체다.
 * 시드는 고유 채널 값으로 격리하고 끝나면 지운다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="profit.query.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_ANALYTICS_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_ANALYTICS_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('ProfitQuery (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const channel = `itest-${randomUUID().slice(0, 8)}`;
  const masterCost = `itest-master-${randomUUID().slice(0, 8)}`; // 원가 있음, 취소 있음
  const masterNoCost = `itest-master-${randomUUID().slice(0, 8)}`; // 원가 없음 — 계산 불가 몫
  const masterCheap = `itest-master-${randomUUID().slice(0, 8)}`; // 원가 있음, 저마진
  const masterNameless = `itest-master-${randomUUID().slice(0, 8)}`; // dim 없음 — 이름 폴백

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let query: ProfitQuery;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    query = new ProfitQuery(dbService);

    await db.insert(dimProductMasters).values([
      { masterId: masterCost, name: '이익테스트 원가상품', supplyPrice: 3000 },
      { masterId: masterNoCost, name: '이익테스트 원가없음' },
      { masterId: masterCheap, name: '이익테스트 저마진', supplyPrice: 900 },
    ]);

    await db.insert(aggProductOrderDaily).values([
      // masterCost: 8/1 10개×1만원, 8/2 취소 2만원 → 순매출 8만, 원가 3만×0.8=2.4만
      { aggDate: '2026-08-01', masterId: masterCost, salesChannel: channel, ordersCount: 2, quantitySold: 10, grossRevenue: 100_000, cancelledAmount: 0, refundedAmount: 0 },
      { aggDate: '2026-08-02', masterId: masterCost, salesChannel: channel, ordersCount: 0, quantitySold: 0, grossRevenue: 0, cancelledAmount: 20_000, refundedAmount: 0 },
      // masterNoCost: 순매출 5만 — 계산 불가 몫으로 분리돼야 한다
      { aggDate: '2026-08-01', masterId: masterNoCost, salesChannel: channel, ordersCount: 1, quantitySold: 5, grossRevenue: 50_000, cancelledAmount: 0, refundedAmount: 0 },
      // masterCheap: 순매출 1만, 원가 10개×900=9000 → 마진 1000 (10%)
      { aggDate: '2026-08-03', masterId: masterCheap, salesChannel: channel, ordersCount: 1, quantitySold: 10, grossRevenue: 10_000, cancelledAmount: 0, refundedAmount: 0 },
      // masterNameless: dim 자체가 없다 — 이름은 주문 라인 폴백, 원가는 계산 불가
      { aggDate: '2026-08-03', masterId: masterNameless, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 1_000, cancelledAmount: 0, refundedAmount: 0 },
      // 직전 기간(7월) — previousTotals 산출용
      { aggDate: '2026-07-05', masterId: masterCost, salesChannel: channel, ordersCount: 1, quantitySold: 2, grossRevenue: 20_000, cancelledAmount: 0, refundedAmount: 0 },
    ]);

    await db.insert(factOrderItems).values([
      {
        messageId: `IT${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        orderKey: `${masterNameless}-o1`,
        salesChannel: channel,
        masterId: masterNameless,
        productName: '폴백 이름',
        quantity: 1,
        occurredAt: new Date('2026-08-03T10:00:00+09:00'),
      },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(aggProductOrderDaily).where(eq(aggProductOrderDaily.salesChannel, channel));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterCost));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterNoCost));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterCheap));
      await db.delete(factOrderItems).where(eq(factOrderItems.masterId, masterNameless));
    }
    await sql?.end();
  });

  it('전사 요약이 계산 가능/불가 몫을 분리해 손계산과 일치한다', async () => {
    const result = await query.getProfit('2026-08-01', '2026-08-31', channel);

    // 순매출: 8만(원가상품) + 5만(원가없음) + 1만(저마진) + 1천(dim없음) = 14.1만
    expect(result.totals).toMatchObject({
      grossRevenue: 161_000,
      cancelledAmount: 20_000,
      refundedAmount: 0,
      netRevenue: 141_000,
      quantitySold: 26,
      productsCount: 4,
      // 계산 가능: 원가상품 8만 + 저마진 1만
      computedNetRevenue: 90_000,
      // 원가상품 10×3000×(8만/10만)=24000 + 저마진 10×900=9000
      estimatedCost: 33_000,
      estimatedMargin: 57_000,
      uncomputedNetRevenue: 51_000,
      uncomputedProductsCount: 2,
    });
    expect(result.totals.marginRate).toBeCloseTo(57_000 / 90_000);
    expect(result.totals.costCoverageRate).toBeCloseTo(90_000 / 141_000);

    // 직전 기간(7월 동일 길이): 원가상품 2만, 원가 2×3000
    expect(result.previousTotals).toMatchObject({
      netRevenue: 20_000,
      computedNetRevenue: 20_000,
      estimatedCost: 6_000,
    });
  });

  it('일별 추이의 원가·마진은 계산 가능 몫만 반영한다', async () => {
    const result = await query.getProfit('2026-08-01', '2026-08-31', channel);
    const byBucket = new Map(result.series.map((point) => [point.bucket, point]));

    expect(byBucket.get('2026-08-01')).toMatchObject({
      netRevenue: 150_000,
      computedNetRevenue: 100_000,
      estimatedCost: 30_000, // 8/1 단독으로는 취소가 없다 — 취소는 8/2 에 귀속
      estimatedMargin: 70_000,
    });
    expect(byBucket.get('2026-08-02')).toMatchObject({
      netRevenue: -20_000,
      computedNetRevenue: -20_000,
      estimatedCost: 0, // 수량 0 — 음수 원가로 내려가면 안 된다
    });
  });

  it('상품 목록: 원가 없는 행은 계산 불가(null), 이름은 주문 라인 폴백', async () => {
    const result = await query.getProfit('2026-08-01', '2026-08-31', channel, 'revenue', 'desc', 1, 50);
    expect(result.totalItems).toBe(4);

    const byMaster = new Map(result.items.map((item) => [item.masterId, item]));
    expect(byMaster.get(masterCost)).toMatchObject({
      netRevenue: 80_000,
      supplyPrice: 3000,
      estimatedCost: 24_000,
      estimatedMargin: 56_000,
    });
    expect(byMaster.get(masterCost)?.marginRate).toBeCloseTo(0.7);
    expect(byMaster.get(masterNoCost)).toMatchObject({
      netRevenue: 50_000,
      supplyPrice: null,
      estimatedCost: null,
      estimatedMargin: null,
      marginRate: null,
    });
    expect(byMaster.get(masterNameless)?.name).toBe('폴백 이름');
  });

  it('마진 정렬은 계산 불가 행을 방향과 무관하게 끝으로 보낸다', async () => {
    const desc = await query.getProfit('2026-08-01', '2026-08-31', channel, 'margin', 'desc', 1, 50);
    expect(desc.items.map((item) => item.masterId).slice(0, 2)).toEqual([masterCost, masterCheap]);
    expect(desc.items.slice(2).every((item) => item.estimatedMargin === null)).toBe(true);

    const asc = await query.getProfit('2026-08-01', '2026-08-31', channel, 'margin', 'asc', 1, 50);
    expect(asc.items.map((item) => item.masterId).slice(0, 2)).toEqual([masterCheap, masterCost]);
    expect(asc.items.slice(2).every((item) => item.estimatedMargin === null)).toBe(true);
  });

  it('페이지네이션: 페이지를 이어 붙이면 전체가 겹침 없이 나온다', async () => {
    const page1 = await query.getProfit('2026-08-01', '2026-08-31', channel, 'revenue', 'desc', 1, 3);
    const page2 = await query.getProfit('2026-08-01', '2026-08-31', channel, 'revenue', 'desc', 2, 3);
    expect(page1.totalItems).toBe(4);
    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(1);
    const all = [...page1.items, ...page2.items].map((item) => item.masterId);
    expect(new Set(all).size).toBe(4);
  });

  it('기간이 뒤집히면 400', async () => {
    await expect(query.getProfit('2026-08-31', '2026-08-01', channel)).rejects.toThrow('조회 기간이 뒤집혔습니다');
  });
});
