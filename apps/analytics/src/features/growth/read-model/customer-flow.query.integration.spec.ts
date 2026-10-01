import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, like } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { aggChannelDaily, analyticsSchema, factOrderEvents, factOrderItems } from '../../../schema';
import { CustomerFlowQuery, OWN_MALL_CHANNEL } from './customer-flow.query';

/**
 * 고객 축(재구매·성장 회계·코호트) 손계산 대조. 2032년 날짜로 시드해 로컬 실데이터와 겹치지 않게 한다.
 *
 * 시드 (자사몰 회원 주문, 금액은 품목 total_price):
 *   c1 첫구매 01-10, 02-20(9,000), 03-03(10,000)
 *   c2 03-02 두 건(5,000·6,000 — 같은 날 분할), 03-10(7,000)
 *   c3 첫구매 01-05, 02-05, 03-05(8,000)
 *   c4 02-18(4,000) 한 번
 *   c5 03-08 — 라인 정보 없는 취소 → 전량 취소, 빠진다
 *   c6 03-09 두 줄(2개×2,000 + 3,000) 중 첫 줄 1개만 복원 → 남은 5,000(2,000 + 3,000)으로 구매
 *   c7 03-11 — 모든 라인 복원 → 전량 취소
 *   c8 03-12 — 라인 정보가 있는데 한 줄도 안 맞음 → 전량 취소(집계와 같은 규칙)
 *   c9 03-04 두 건(1,000·1,000)만 — 같은 날 분할뿐이라 재구매가 아니다
 * 이번 기간 03-01~03-14(월요일 시작 2주), 직전 02-16~02-29, 그 전 02-02~02-15.
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="customer-flow.query.integration" --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CustomerFlowQuery (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const prefix = `itg-${randomUUID().slice(0, 8)}`;
  const cust = (n: number) => `${prefix}-c${n}`;
  const key = (n: string) => `${prefix}-K${n}`;
  const messageId = () => `IT${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const today = '2032-04-14';

  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let query: CustomerFlowQuery;

  const line = (customer: number, orderKey: string, day: string, price: number, opts: { item?: string; qty?: number } = {}) => ({
    messageId: messageId(),
    orderKey,
    orderId: orderKey,
    orderItemId: opts.item ?? `${orderKey}-a`,
    salesChannel: OWN_MALL_CHANNEL,
    customerId: cust(customer),
    masterId: `${prefix}-m`,
    quantity: opts.qty ?? 1,
    totalPrice: price,
    occurredAt: new Date(`${day}T12:00:00+09:00`),
  });
  const cancel = (orderKey: string, restorations?: Array<{ orderItemId: string; restoredQty: number }>) => ({
    messageId: messageId(),
    messageType: 'OrderCancelled',
    messageKind: 'event',
    correlationId: messageId(),
    orderId: orderKey,
    occurredAt: new Date(),
    payload: restorations ? { orderId: orderKey, stockRestorationResults: restorations } : { orderId: orderKey },
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    query = new CustomerFlowQuery(dbService);

    await db.insert(factOrderItems).values([
      line(1, key('1a'), '2032-01-10', 1000),
      line(1, key('1b'), '2032-02-20', 9000),
      line(1, key('1c'), '2032-03-03', 10000),
      line(2, key('2a'), '2032-03-02', 5000),
      line(2, key('2b'), '2032-03-02', 6000),
      line(2, key('2c'), '2032-03-10', 7000),
      line(3, key('3a'), '2032-01-05', 1000),
      line(3, key('3b'), '2032-02-05', 1000),
      line(3, key('3c'), '2032-03-05', 8000),
      line(4, key('4a'), '2032-02-18', 4000),
      line(5, key('5a'), '2032-03-08', 99000),
      line(6, key('6a'), '2032-03-09', 4000, { item: `${key('6a')}-x`, qty: 2 }),
      line(6, key('6a'), '2032-03-09', 3000, { item: `${key('6a')}-y`, qty: 1 }),
      line(7, key('7a'), '2032-03-11', 99000),
      line(8, key('8a'), '2032-03-12', 99000),
      line(9, key('9a'), '2032-03-04', 1000),
      line(9, key('9b'), '2032-03-04', 1000),
    ]);
    await db.insert(factOrderEvents).values([
      cancel(key('5a')),
      cancel(key('6a'), [{ orderItemId: `${key('6a')}-x`, restoredQty: 1 }]),
      cancel(key('7a'), [{ orderItemId: `${key('7a')}-a`, restoredQty: 1 }]),
      cancel(key('8a'), [{ orderItemId: 'no-such-line', restoredQty: 1 }]),
    ]);
    await db.insert(aggChannelDaily).values({
      aggDate: '2032-03-05', salesChannel: OWN_MALL_CHANNEL, ordersCount: 12, grossRevenue: 0, cancelledAmount: 0, refundedAmount: 0,
    });
  });

  afterAll(async () => {
    if (db) {
      await db.delete(factOrderItems).where(like(factOrderItems.orderKey, `${prefix}-%`));
      await db.delete(factOrderEvents).where(like(factOrderEvents.orderId, `${prefix}-%`));
      await db
        .delete(aggChannelDaily)
        .where(and(eq(aggChannelDaily.aggDate, '2032-03-05'), eq(aggChannelDaily.salesChannel, OWN_MALL_CHANNEL)));
    }
    await sql?.end();
  });

  it('기간 고객 — 전량 취소는 빠지고, 같은 날 분할 주문은 재구매가 아니며, 부분 취소는 남은 금액으로 남는다', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    expect(r.previousRange).toEqual({ from: '2032-02-16', to: '2032-02-29' });
    expect(r.current).toEqual({
      buyers: 5,
      newBuyers: 3,
      returningBuyers: 2,
      repeatBuyers: 1,
      newBuyerRevenue: 25000,
      returningBuyerRevenue: 18000,
    });
    expect(r.previous).toEqual({
      buyers: 2,
      newBuyers: 1,
      returningBuyers: 1,
      repeatBuyers: 0,
      newBuyerRevenue: 4000,
      returningBuyerRevenue: 9000,
    });
  });

  it('성장 회계 — 신규·유지·복귀·이탈과 퀵 레이쇼', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    expect(r.growthAccounting.current).toEqual({ newCustomers: 3, retained: 1, resurrected: 1, churned: 1, quickRatio: 4 });
    expect(r.growthAccounting.previous).toEqual({ newCustomers: 1, retained: 0, resurrected: 1, churned: 1, quickRatio: 2 });
  });

  it('시계열 — 일·주(월요일 시작)·월 버킷에서 신규/기존 구매자가 버킷 첫날 기준으로 갈린다', async () => {
    const day = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    expect(day.series).toEqual([
      { bucket: '2032-03-02', buyers: 1, newBuyers: 1, returningBuyers: 0 },
      { bucket: '2032-03-03', buyers: 1, newBuyers: 0, returningBuyers: 1 },
      { bucket: '2032-03-04', buyers: 1, newBuyers: 1, returningBuyers: 0 },
      { bucket: '2032-03-05', buyers: 1, newBuyers: 0, returningBuyers: 1 },
      { bucket: '2032-03-09', buyers: 1, newBuyers: 1, returningBuyers: 0 },
      { bucket: '2032-03-10', buyers: 1, newBuyers: 0, returningBuyers: 1 },
    ]);
    const week = await query.getFlow('2032-03-01', '2032-03-14', 'week', today);
    expect(week.series).toEqual([
      { bucket: '2032-03-01', buyers: 4, newBuyers: 2, returningBuyers: 2 },
      { bucket: '2032-03-08', buyers: 2, newBuyers: 1, returningBuyers: 1 },
    ]);
    const month = await query.getFlow('2032-03-01', '2032-03-14', 'month', today);
    expect(month.series).toEqual([{ bucket: '2032-03', buyers: 5, newBuyers: 3, returningBuyers: 2 }]);
  });

  it('N일 재구매 코호트 — 창이 다 지나지 않은 고객은 분모에서 빼고 «집계 중»으로 센다', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    const jan = r.cohorts.find((c) => c.cohortMonth === '2032-01');
    // c3 두번째 31일 후, c1 41일 후 → 30일 0명, 60·90일 2명.
    expect(jan).toEqual({
      cohortMonth: '2032-01',
      size: 2,
      windows: [
        { days: 30, matured: 2, repeaters: 0, immature: 0 },
        { days: 60, matured: 2, repeaters: 2, immature: 0 },
        { days: 90, matured: 2, repeaters: 2, immature: 0 },
      ],
    });
    const mar = r.cohorts.find((c) => c.cohortMonth === '2032-03');
    // c2 8일 후 재구매, c6·c9 없음(c9 는 같은 날 두 건뿐). 60일은 오늘(04-14) 기준 아직 안 지났다.
    expect(mar?.windows).toEqual([
      { days: 30, matured: 3, repeaters: 1, immature: 0 },
      { days: 60, matured: 0, repeaters: 0, immature: 3 },
      { days: 90, matured: 0, repeaters: 0, immature: 3 },
    ]);
  });

  it('90일 재구매율 헤드라인 — 90일이 다 지난 가장 최근 첫구매 고객 묶음', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    expect(r.repeatHeadline.current).toEqual({ firstBuyers: 2, repeaters: 2, from: '2031-10-17', to: '2032-01-14' });
  });

  it('두 번째 구매까지 걸린 일수와 재구매 시기 도래 고객', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    // 간격 8·31·41일 → p25 19.5, p50 31, p75 36.
    expect(r.timeToSecond).toEqual({ p25: 19.5, p50: 31, p75: 36, n: 3 });
    // 1회 구매 고객 c4(57일)·c6(36일)·c9(41일) 중 19~36일 구간은 c6 하나.
    expect(r.repurchaseDue).toEqual({ customers: 1, fromDays: 19, toDays: 36 });
  });

  it('모수 — 자사몰 주문 수 대비 회원 주문 수(취소 포함)', async () => {
    const r = await query.getFlow('2032-03-01', '2032-03-14', 'day', today);
    expect(r.coverage).toEqual({ ownMallOrders: 12, memberOrders: 11 });
  });
});
