import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import {
  aggChannelDaily,
  aggMembershipDaily,
  aggProductOrderDaily,
  aggVariantOrderDaily,
  analyticsSchema,
  dimCustomerMembership,
  dimProductCategories,
  dimProductMasters,
  dimProductVariants,
  factOrderItems,
} from '../../../schema';
import { MembershipDailySnapshotService } from '../../../datasets/memberships/aggregates/membership-daily-snapshot.service';
import { toSeoulDateOnly } from '../../../shared/date.util';
import { StatisticsQuery } from './statistics.query';

/**
 * 통계 read-model 을 실 Postgres 로 검증한다 — 검증 대상이 SQL(그룹핑·조인·집계) 자체라
 * 목으로는 아무것도 확인하지 못한다. 시드는 고유 채널/tier 값으로 격리하고 끝나면 지운다.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="statistics.query.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_ANALYTICS_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_ANALYTICS_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('StatisticsQuery (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const channel = `itest-${randomUUID().slice(0, 8)}`;
  const masterA = `itest-master-${randomUUID().slice(0, 8)}`;
  const masterB = `itest-master-${randomUUID().slice(0, 8)}`;
  const masterC = `itest-master-${randomUUID().slice(0, 8)}`; // dim 에 이름 없음 — fact 폴백 검증용
  const masterD = `itest-master-${randomUUID().slice(0, 8)}`; // 활성인데 8월 판매 없음 — 무판매 목록 검증용
  const masterE = `itest-master-${randomUUID().slice(0, 8)}`; // 비활성 — 무판매 목록에서 제외돼야 함
  const variantC = `itest-variant-${randomUUID().slice(0, 8)}`;
  const categoryId = `itest-cat-${randomUUID().slice(0, 8)}`;
  const tierId = `itest-tier-${randomUUID().slice(0, 8)}`;
  const userPrefix = `itest-user-${randomUUID().slice(0, 8)}`;

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let query: StatisticsQuery;
  let snapshot: MembershipDailySnapshotService;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    query = new StatisticsQuery(dbService);
    snapshot = new MembershipDailySnapshotService(dbService);

    // 채널 일별: 7월 2일 + 8월 1·2일. 8월 2일에 취소가 얹힌다.
    await db.insert(aggChannelDaily).values([
      { aggDate: '2026-07-02', salesChannel: channel, ordersCount: 1, grossRevenue: 7000, cancelledAmount: 0, refundedAmount: 0 },
      { aggDate: '2026-08-01', salesChannel: channel, ordersCount: 2, grossRevenue: 10000, cancelledAmount: 0, refundedAmount: 0 },
      { aggDate: '2026-08-02', salesChannel: channel, ordersCount: 1, grossRevenue: 5000, cancelledAmount: 8000, refundedAmount: 1000 },
    ]);

    await db.insert(dimProductMasters).values([
      { masterId: masterA, name: '통합테스트 상품 A', isActive: true },
      { masterId: masterB, name: '통합테스트 상품 B' },
      { masterId: masterD, name: '통합테스트 상품 D', isActive: true },
      { masterId: masterE, name: '통합테스트 상품 E', isActive: false },
    ]);
    await db.insert(dimProductCategories).values([
      { masterId: masterA, categoryId, categoryName: '통합테스트 카테고리', isPrimary: true },
      // primary 아님 — 카테고리 구성에 잡히면 중복 가산 버그다.
      { masterId: masterB, categoryId: `${categoryId}-secondary`, isPrimary: false },
    ]);
    await db.insert(aggProductOrderDaily).values([
      { aggDate: '2026-08-01', masterId: masterA, salesChannel: channel, ordersCount: 2, quantitySold: 3, grossRevenue: 9000, cancelledAmount: 1000, refundedAmount: 0 },
      { aggDate: '2026-08-02', masterId: masterB, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 6000, cancelledAmount: 0, refundedAmount: 0 },
      // 직전 기간(7월) — previousNetRevenue 산출용
      { aggDate: '2026-07-02', masterId: masterA, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 4000, cancelledAmount: 0, refundedAmount: 0 },
      // dim 없는 상품 — 이름은 주문 라인 폴백으로 온다
      { aggDate: '2026-08-03', masterId: masterC, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 1000, cancelledAmount: 0, refundedAmount: 0 },
      // 활성 상품 D 는 7월에만 팔렸다 — 8월 조회에서 무판매 목록에 마지막 판매일과 함께 나와야 한다.
      { aggDate: '2026-07-02', masterId: masterD, salesChannel: channel, ordersCount: 1, quantitySold: 1, grossRevenue: 2000, cancelledAmount: 0, refundedAmount: 0 },
    ]);

    // 주문 라인 2건 — 폴백은 더 최근(occurredAt) 이름을 골라야 한다.
    await db.insert(factOrderItems).values([
      { messageId: `IT${randomUUID().replace(/-/g, '').slice(0, 24)}`, orderKey: `${masterC}-o1`, salesChannel: channel, masterId: masterC, productName: '옛 상품명', quantity: 1, occurredAt: new Date('2026-08-01T10:00:00+09:00') },
      { messageId: `IT${randomUUID().replace(/-/g, '').slice(0, 24)}`, orderKey: `${masterC}-o2`, salesChannel: channel, masterId: masterC, productName: '폴백 상품명', quantity: 1, occurredAt: new Date('2026-08-03T10:00:00+09:00') },
    ]);

    // 옵션 집계: dim 은 이름 없는 기본 품목 — isDefault 가 내려가고 masterName 은 폴백돼야 한다.
    await db.insert(dimProductVariants).values([
      { variantId: variantC, masterId: masterC, versionId: `${masterC}-v1`, variantName: null, isDefault: true, status: 'ACTIVE' },
    ]);
    await db.insert(aggVariantOrderDaily).values([
      { aggDate: '2026-08-03', variantId: variantC, masterId: masterC, salesChannel: channel, quantitySold: 1, grossRevenue: 1000 },
    ]);

    // 멤버십 dim: 열린 구간 2명 + 이미 닫힌 구간 1명 (스냅샷은 열린 구간만 세야 한다)
    await db.insert(dimCustomerMembership).values([
      { userId: `${userPrefix}-1`, tierId, validFrom: new Date('2026-08-01T00:00:00+09:00'), validTo: null },
      { userId: `${userPrefix}-2`, tierId, validFrom: new Date('2026-08-10T00:00:00+09:00'), validTo: null },
      { userId: `${userPrefix}-3`, tierId, validFrom: new Date('2026-07-01T00:00:00+09:00'), validTo: new Date('2026-08-01T00:00:00+09:00') },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(aggChannelDaily).where(eq(aggChannelDaily.salesChannel, channel));
      await db.delete(aggProductOrderDaily).where(eq(aggProductOrderDaily.salesChannel, channel));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterA));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterB));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterD));
      await db.delete(dimProductMasters).where(eq(dimProductMasters.masterId, masterE));
      await db.delete(dimProductCategories).where(eq(dimProductCategories.masterId, masterA));
      await db.delete(dimProductCategories).where(eq(dimProductCategories.masterId, masterB));
      await db.delete(factOrderItems).where(eq(factOrderItems.masterId, masterC));
      await db.delete(dimProductVariants).where(eq(dimProductVariants.variantId, variantC));
      await db.delete(aggVariantOrderDaily).where(eq(aggVariantOrderDaily.salesChannel, channel));
      await db.delete(dimCustomerMembership).where(eq(dimCustomerMembership.tierId, tierId));
      await db.delete(aggMembershipDaily).where(eq(aggMembershipDaily.tierId, tierId));
    }
    await sql?.end();
  });

  it('매출 KPI·시계열·전기간 비교가 컬럼 합과 일치한다', async () => {
    const result = await query.getSales('2026-08-01', '2026-08-31', channel, 'day');

    expect(result.kpis).toMatchObject({
      grossRevenue: 15000,
      cancelledAmount: 8000,
      refundedAmount: 1000,
      netRevenue: 6000,
      ordersCount: 3,
      avgOrderValue: 2000,
      cancelRefundRate: 9000 / 15000,
    });
    // 직전 동일 길이 기간(7월) 에는 7월 2일 한 건만 있다.
    expect(result.previousRange).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(result.previousKpis).toMatchObject({ grossRevenue: 7000, netRevenue: 7000, ordersCount: 1 });

    expect(result.series.map((row) => row.bucket)).toEqual(['2026-08-01', '2026-08-02']);
    expect(result.series[1]).toMatchObject({ grossRevenue: 5000, netRevenue: -4000 }); // 음수 순매출 보존
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toMatchObject({ salesChannel: channel, netRevenue: 6000 });
  });

  it('월별 버킷이 to_char 그룹핑으로 합쳐진다', async () => {
    const result = await query.getSales('2026-07-01', '2026-08-31', channel, 'month');
    expect(result.series.map((row) => row.bucket)).toEqual(['2026-07', '2026-08']);
    expect(result.series[1]).toMatchObject({ grossRevenue: 15000, ordersCount: 3 });
  });

  it('상품 랭킹에 이름·순매출·전기간 순매출이 붙는다', async () => {
    const result = await query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 10);

    expect(result.ranking).toHaveLength(3);
    const [first, second, third] = result.ranking;
    expect(first).toMatchObject({ masterId: masterA, name: '통합테스트 상품 A', netRevenue: 8000, previousNetRevenue: 4000 });
    expect(second).toMatchObject({ masterId: masterB, netRevenue: 6000, previousNetRevenue: 0 });
    // dim 에 이름이 없으면 가장 최근 주문 라인의 상품명으로 폴백한다.
    expect(third).toMatchObject({ masterId: masterC, name: '폴백 상품명', netRevenue: 1000 });

    // primary 카테고리만 — masterB 의 비-primary 링크는 잡히면 안 된다. 이름도 함께 내려간다.
    expect(result.categories).toEqual([
      { categoryId, categoryName: '통합테스트 카테고리', grossRevenue: 9000, quantitySold: 3 },
    ]);
  });

  it('order=asc 는 같은 랭킹을 하위부터 내린다', async () => {
    const result = await query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 10, 'asc');
    expect(result.ranking.map((row) => row.masterId)).toEqual([masterC, masterB, masterA]);
    // 방향만 바뀌고 값 계산은 동일해야 한다.
    expect(result.ranking[2]).toMatchObject({ masterId: masterA, netRevenue: 8000, previousNetRevenue: 4000 });
  });

  it('무판매 목록은 기간 내 판매 0건인 활성 상품만 마지막 판매일과 함께 내린다', async () => {
    const result = await query.getUnsoldProducts('2026-08-01', '2026-08-31', channel, 200);

    const rowD = result.items.find((row) => row.masterId === masterD);
    expect(rowD).toMatchObject({ name: '통합테스트 상품 D', lastSoldDate: '2026-07-02' });
    expect(result.total).toBeGreaterThanOrEqual(1);

    const ids = result.items.map((row) => row.masterId);
    expect(ids).not.toContain(masterA); // 기간 내 판매 있음
    expect(ids).not.toContain(masterE); // 비활성
    expect(ids).not.toContain(masterB); // isActive 미설정(null)

    // 판매 기록 없는(null) 상품이 마지막 판매일 있는 상품보다 앞에 온다.
    const firstDated = result.items.findIndex((row) => row.lastSoldDate !== null);
    if (firstDated >= 0) {
      expect(result.items.slice(firstDated).every((row) => row.lastSoldDate !== null)).toBe(true);
    }

    // 7월 조회에서는 D 가 팔렸으므로 빠져야 한다.
    const july = await query.getUnsoldProducts('2026-07-01', '2026-07-31', channel, 200);
    expect(july.items.map((row) => row.masterId)).not.toContain(masterD);
  });

  it('랭킹 페이지네이션 — limit=1 로 세 페이지를 걸으면 전 상품이 한 번씩 나온다', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((page) => query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 1, 'desc', page)),
    );

    expect(pages.map((p) => p.ranking.map((row) => row.masterId)).flat()).toEqual([masterA, masterB, masterC]);
    for (const [index, result] of pages.entries()) {
      expect(result.rankingTotalItems).toBe(3);
      expect(result.page).toBe(index + 1);
      expect(result.limit).toBe(1);
    }
    // 범위 밖 페이지는 빈 목록 — 총건수는 유지된다.
    const beyond = await query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 1, 'desc', 4);
    expect(beyond.ranking).toEqual([]);
    expect(beyond.rankingTotalItems).toBe(3);
  });

  it('옵션별 판매 페이지네이션은 랭킹과 독립으로 움직인다', async () => {
    const result = await query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 1, 'desc', 1, 2);
    // variantPage=2 — 채널 내 옵션 행은 1개뿐이라 빈 목록, 랭킹(page=1)은 그대로.
    expect(result.variants).toEqual([]);
    expect(result.variantTotalItems).toBe(1);
    expect(result.variantPage).toBe(2);
    expect(result.ranking.map((row) => row.masterId)).toEqual([masterA]);
  });

  it('무판매 목록 페이지네이션 — page 와 limit 이 응답에 실리고 범위 밖 페이지는 비어 있다', async () => {
    const first = await query.getUnsoldProducts('2026-08-01', '2026-08-31', channel, 1, 1);
    expect(first.items).toHaveLength(1);
    expect(first.page).toBe(1);
    expect(first.limit).toBe(1);

    const beyond = await query.getUnsoldProducts('2026-08-01', '2026-08-31', channel, 200, first.total + 1);
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(first.total);
  });

  it('옵션별 판매는 기본 품목 여부와 폴백된 상품명을 함께 내린다', async () => {
    const result = await query.getProducts('2026-08-01', '2026-08-31', channel, 'revenue', 10);
    const row = result.variants.find((v) => v.variantId === variantC);
    expect(row).toMatchObject({ variantName: null, isDefault: true, masterId: masterC, masterName: '폴백 상품명' });
  });

  it('스냅샷은 열린 구간만 세고, 재실행해도 값이 변하지 않는다', async () => {
    const today = toSeoulDateOnly(new Date());
    await snapshot.snapshotFor(today);
    await snapshot.snapshotFor(today); // 멱등 확인

    const rows = await db
      .select()
      .from(aggMembershipDaily)
      .where(and(eq(aggMembershipDaily.aggDate, today), eq(aggMembershipDaily.tierId, tierId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', membersCount: 2 });

    // getCustomers 의 membershipTrend 로도 같은 값이 나온다.
    const customers = await query.getCustomers(today, today);
    const trendRow = customers.membershipTrend.find((row) => row.tierId === tierId);
    expect(trendRow).toMatchObject({ aggDate: today, membersCount: 2 });
  });

  it('과거 날짜 스냅샷은 그 시점에 열려 있던 구간으로 재계산된다', async () => {
    await snapshot.snapshotFor('2026-08-05');
    const rows = await db
      .select()
      .from(aggMembershipDaily)
      .where(and(eq(aggMembershipDaily.aggDate, '2026-08-05'), eq(aggMembershipDaily.tierId, tierId)));
    // 8월 5일 00:00 KST 기준: user-1 만 열려 있다 (user-2 는 8/10 시작, user-3 은 8/1 종료).
    expect(rows).toHaveLength(1);
    expect(rows[0].membersCount).toBe(1);
  });

  it('요약의 데이터 기준 시각은 집계 갱신 시각을 UTC ISO 로 왕복 보존한다', async () => {
    // 이 표의 updated_at 은 timestamp(무 시간대)이고 저장값이 UTC 벽시계다.
    //
    // 위험한 축은 **Node 프로세스 시간대**다. `sql<Date>\`MAX(...)\`` 로 받으면 드라이버가
    // 벽시계를 로컬 시간으로 읽어 TZ=Asia/Seoul 개발 머신에서만 9시간 어긋난다
    // (라이브·CI 는 UTC 라 통과한다 — 로컬에서만 나는 종류의 버그다).
    // jest 는 TZ 를 UTC 로 고정하므로 이 스펙 자체는 그 축을 재현하지 못한다.
    // 재현은 `TZ=Asia/Seoul npx jest --testPathPattern="statistics.query.integration"`.
    // 여기서는 계약(넣은 순간이 그대로 돌아온다)을 고정하고, 세션 시간대에도 흔들리지 않음을 본다.
    const marker = new Date('2031-03-01T04:05:06.000Z');
    await db.insert(aggChannelDaily).values({
      aggDate: '2031-03-01',
      salesChannel: channel,
      grossRevenue: 0,
      cancelledAmount: 0,
      refundedAmount: 0,
      ordersCount: 0,
      updatedAt: marker,
    });

    await sql`SET TIME ZONE 'Asia/Seoul'`;
    try {
      const seoulSession = await query.getOverview();
      expect(seoulSession.dataAsOf).toBe(marker.toISOString());
    } finally {
      await sql`SET TIME ZONE 'UTC'`;
    }

    const utcSession = await query.getOverview();
    expect(utcSession.dataAsOf).toBe(marker.toISOString());
  });
});
