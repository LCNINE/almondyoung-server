import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  aggProductOrderDaily,
  aggVariantOrderDaily,
  analyticsSchema,
  dimProductMasters,
  dimProductVariants,
  factOrderItems,
} from '../../../schema';
import { ProfitQuery } from './profit.query';
import { OperatingCostService } from '../settings/operating-cost.service';
import { ProductDiagnosisQuery } from './product-diagnosis.query';

/**
 * 상품 단건 진단 read-model 을 실 Postgres 로 검증한다 — 검증 대상이 SQL(단건 필터·직전 기간·
 * 옵션 그룹핑) 자체다. 시드는 고유 채널 값으로 격리하고 끝나면 지운다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="product-diagnosis.query.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_ANALYTICS_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_ANALYTICS_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('ProductDiagnosisQuery (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const channel = `itest-${randomUUID().slice(0, 8)}`;
  const otherChannel = `itest-other-${randomUUID().slice(0, 8)}`;
  const target = `itest-master-${randomUUID().slice(0, 8)}`; // 원가 있음, 취소 있음
  const noise = `itest-master-${randomUUID().slice(0, 8)}`; // 같은 기간 다른 상품 — 섞이면 안 된다
  const nameless = `itest-master-${randomUUID().slice(0, 8)}`; // dim 없음 — 이름 폴백
  const variantA = `itest-variant-${randomUUID().slice(0, 8)}`;
  const variantB = `itest-variant-${randomUUID().slice(0, 8)}`;

  // 조회 기간 8/10~8/19 (10일), 직전 기간 8/00~8/09 → 실제로는 7/31~8/09
  const from = '2026-08-10';
  const to = '2026-08-19';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let query: ProductDiagnosisQuery;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    query = new ProductDiagnosisQuery(dbService, new ProfitQuery(dbService, new OperatingCostService(dbService)));

    await db.insert(dimProductMasters).values([
      { masterId: target, name: '진단테스트 대상', supplyPrice: 3000 },
      { masterId: noise, name: '진단테스트 노이즈', supplyPrice: 1000 },
    ]);
    await db.insert(dimProductVariants).values([
      { variantId: variantA, masterId: target, versionId: 'v1', variantName: '옵션 A', isDefault: false },
      { variantId: variantB, masterId: target, versionId: 'v1', variantName: '옵션 B', isDefault: false },
    ]);

    await db.insert(aggProductOrderDaily).values([
      // 대상: 조회 기간 안 — 총매출 100,000 / 취소 10,000 / 환불 5,000 → 순매출 85,000, 수량 20
      { aggDate: '2026-08-11', masterId: target, salesChannel: channel, ordersCount: 3, quantitySold: 12, grossRevenue: 60_000, cancelledAmount: 10_000, refundedAmount: 0 },
      { aggDate: '2026-08-18', masterId: target, salesChannel: channel, ordersCount: 2, quantitySold: 8, grossRevenue: 40_000, cancelledAmount: 0, refundedAmount: 5_000 },
      // 대상: 다른 채널 — 채널 필터를 걸면 빠져야 한다
      { aggDate: '2026-08-12', masterId: target, salesChannel: otherChannel, ordersCount: 1, quantitySold: 5, grossRevenue: 25_000, cancelledAmount: 0, refundedAmount: 0 },
      // 대상: 직전 기간 — 순매출 40,000
      { aggDate: '2026-08-05', masterId: target, salesChannel: channel, ordersCount: 1, quantitySold: 4, grossRevenue: 40_000, cancelledAmount: 0, refundedAmount: 0 },
      // 대상: 조회 기간 밖(뒤) — 어디에도 안 들어가야 한다
      { aggDate: '2026-08-25', masterId: target, salesChannel: channel, ordersCount: 9, quantitySold: 99, grossRevenue: 999_000, cancelledAmount: 0, refundedAmount: 0 },
      // 노이즈 상품: 같은 기간 — 대상 수치에 섞이면 안 된다
      { aggDate: '2026-08-11', masterId: noise, salesChannel: channel, ordersCount: 7, quantitySold: 70, grossRevenue: 700_000, cancelledAmount: 0, refundedAmount: 0 },
      // 이름 없는 상품(dim 없음)
      { aggDate: '2026-08-11', masterId: nameless, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 1_000, cancelledAmount: 0, refundedAmount: 0 },
    ]);

    await db.insert(aggVariantOrderDaily).values([
      { aggDate: '2026-08-11', masterId: target, variantId: variantA, salesChannel: channel, quantitySold: 8, grossRevenue: 40_000 },
      { aggDate: '2026-08-18', masterId: target, variantId: variantA, salesChannel: channel, quantitySold: 4, grossRevenue: 20_000 },
      { aggDate: '2026-08-11', masterId: target, variantId: variantB, salesChannel: channel, quantitySold: 8, grossRevenue: 40_000 },
      // 대상의 옵션 A, 다른 채널 — 채널 필터를 걸면 빠져야 한다
      { aggDate: '2026-08-12', masterId: target, variantId: variantA, salesChannel: otherChannel, quantitySold: 5, grossRevenue: 25_000 },
      // 다른 상품의 옵션 — 섞이면 안 된다
      { aggDate: '2026-08-11', masterId: noise, variantId: `itest-variant-${randomUUID().slice(0, 8)}`, salesChannel: channel, quantitySold: 70, grossRevenue: 700_000 },
    ]);

    await db.insert(factOrderItems).values({
      messageId: randomUUID().replace(/-/g, '').slice(0, 26),
      orderKey: `itest-order-${randomUUID().slice(0, 8)}`,
      orderItemId: randomUUID(),
      masterId: nameless,
      productName: '주문 라인이 실어온 이름',
      quantity: 1,
      unitPrice: 1_000,
      totalPrice: 1_000,
      occurredAt: new Date('2026-08-11T00:00:00Z'),
      salesChannel: channel,
    });
  });

  afterAll(async () => {
    await db.delete(aggVariantOrderDaily).where(eq(aggVariantOrderDaily.salesChannel, channel));
    await db.delete(aggVariantOrderDaily).where(eq(aggVariantOrderDaily.salesChannel, otherChannel));
    await db.delete(aggProductOrderDaily).where(eq(aggProductOrderDaily.salesChannel, channel));
    await db.delete(aggProductOrderDaily).where(eq(aggProductOrderDaily.salesChannel, otherChannel));
    await db.delete(factOrderItems).where(eq(factOrderItems.masterId, nameless));
    await db.delete(dimProductVariants).where(eq(dimProductVariants.masterId, target));
    await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, target));
    await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, noise));
    await sql.end({ timeout: 5 });
  });

  it('그 상품의 기간 실적만 센다 — 같은 기간의 다른 상품이 섞이지 않는다', async () => {
    const result = await query.getDiagnosis(target, from, to, channel);

    expect(result.masterId).toBe(target);
    expect(result.name).toBe('진단테스트 대상');
    expect(result.sales).toEqual({
      ordersCount: 5,
      quantitySold: 20,
      grossRevenue: 100_000,
      cancelledAmount: 10_000,
      refundedAmount: 5_000,
      netRevenue: 85_000,
      previousNetRevenue: 40_000,
    });
  });

  it('조회 기간 밖의 매출은 직전 기간에도 현재 기간에도 안 들어간다', async () => {
    const result = await query.getDiagnosis(target, from, to, channel);
    // 8/25 의 999,000 이 어느 쪽에든 새면 이 두 값이 깨진다
    expect(result.sales.grossRevenue).toBe(100_000);
    expect(result.sales.previousNetRevenue).toBe(40_000);
    expect(result.previousRange).toEqual({ from: '2026-07-31', to: '2026-08-09' });
  });

  it('채널 필터는 매출·옵션 양쪽에 걸린다', async () => {
    const withChannel = await query.getDiagnosis(target, from, to, channel);
    const allChannels = await query.getDiagnosis(target, from, to);

    expect(withChannel.sales.grossRevenue).toBe(100_000);
    expect(withChannel.variants.find((row) => row.variantId === variantA)?.grossRevenue).toBe(60_000);

    // 채널을 안 걸면 다른 채널의 25,000 이 양쪽에 더해진다
    expect(allChannels.sales.grossRevenue).toBe(125_000);
    expect(allChannels.variants.find((row) => row.variantId === variantA)?.grossRevenue).toBe(85_000);
  });

  it('마진은 공급가 × 판매수량을 순매출 비율로 보정한 값이다', async () => {
    const result = await query.getDiagnosis(target, from, to, channel);
    // 3,000 × 20 = 60,000, 순매출/총매출 = 85,000/100,000 = 0.85 → 51,000
    expect(result.margin.supplyPrice).toBe(3000);
    expect(result.margin.estimatedCost).toBe(51_000);
    expect(result.margin.estimatedMargin).toBe(34_000);
    expect(result.margin.marginRate).toBeCloseTo(34_000 / 85_000);
  });

  it('공급가가 없으면 마진 네 값이 전부 null 이다 — 0 으로 뭉개지 않는다', async () => {
    const result = await query.getDiagnosis(nameless, from, to, channel);
    expect(result.margin).toEqual({
      supplyPrice: null,
      estimatedCost: null,
      estimatedMargin: null,
      marginRate: null,
    });
  });

  it('dim 에 이름이 없으면 주문 라인이 실어온 이름으로 폴백한다', async () => {
    const result = await query.getDiagnosis(nameless, from, to, channel);
    expect(result.name).toBe('주문 라인이 실어온 이름');
  });

  it('집계에 아예 없는 상품도 404 가 아니라 0 으로 채운 응답이다 — 다른 축은 보여야 한다', async () => {
    const result = await query.getDiagnosis(`itest-missing-${randomUUID()}`, from, to, channel);
    expect(result.sales).toEqual({
      ordersCount: 0,
      quantitySold: 0,
      grossRevenue: 0,
      cancelledAmount: 0,
      refundedAmount: 0,
      netRevenue: 0,
      previousNetRevenue: 0,
    });
    expect(result.name).toBeNull();
    expect(result.variants).toEqual([]);
  });

  it('옵션은 그 상품 것만, 총매출 내림차순으로 준다', async () => {
    const result = await query.getDiagnosis(target, from, to, channel);
    expect(result.variants).toEqual([
      { variantId: variantA, variantName: '옵션 A', isDefault: false, quantitySold: 12, grossRevenue: 60_000 },
      { variantId: variantB, variantName: '옵션 B', isDefault: false, quantitySold: 8, grossRevenue: 40_000 },
    ]);
  });

  it('비교 기준(benchmark)은 masterId 로 좁혀지지 않는다 — 전사 값이라야 비교가 된다', async () => {
    const result = await query.getDiagnosis(target, from, to, channel);
    // 같은 기간 같은 채널에 노이즈 상품이 있으므로 전사 상품 수는 1보다 크다
    expect(result.benchmark.productsCount).toBeGreaterThan(1);
    expect(result.benchmark.netRevenue).toBeGreaterThan(result.sales.netRevenue);
  });

  it('기간이 뒤집히면 조회하지 않고 막는다', async () => {
    await expect(query.getDiagnosis(target, to, from, channel)).rejects.toThrow();
  });
});
