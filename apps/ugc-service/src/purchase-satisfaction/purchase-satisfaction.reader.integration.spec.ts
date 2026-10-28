import { randomUUID } from 'crypto';
import { like } from 'drizzle-orm';
import { purchaseSatisfactions } from '../db/schema';
import { makeTestDb, type TestDrizzle } from '../shop-listings/__tests__/shop-listing-test-db';
import { PurchaseSatisfactionManager } from './purchase-satisfaction.manager';
import { PurchaseSatisfactionReader } from './purchase-satisfaction.reader';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="purchase-satisfaction.reader.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('PurchaseSatisfactionReader (integration)', () => {
  const prefix = `it-${randomUUID().slice(0, 8)}`;
  const admin = randomUUID();
  let db: TestDrizzle;
  let end: () => Promise<void>;
  let manager: PurchaseSatisfactionManager;
  let reader: PurchaseSatisfactionReader;
  let ids: Record<number, string>;

  const DAY = '2001-03-04';
  const OTHER_DAY = '2001-03-05';
  const at = (ymd: string) => new Date(`${ymd}T03:00:00.000Z`);

  beforeAll(async () => {
    const t = makeTestDb(DATABASE_URL as string);
    db = t.db;
    end = () => t.sql.end();
    manager = new PurchaseSatisfactionManager(t.dbService);
    reader = new PurchaseSatisfactionReader(t.dbService);
    await db.delete(purchaseSatisfactions).where(like(purchaseSatisfactions.orderId, `${prefix}%`));
    ids = {};
    for (const rating of [1, 2, 3, 4, 5]) {
      const [row] = await db
        .insert(purchaseSatisfactions)
        .values({
          orderId: `${prefix}-${rating}`,
          orderDisplayId: rating,
          userId: randomUUID(),
          rating,
          reasons: rating === 2 ? ['PAYMENT_ERROR'] : [],
          memo: rating === 2 ? '결제가 안 됐어요' : null,
          checkedAt: rating === 5 ? at(DAY) : null,
          checkedBy: rating === 5 ? admin : null,
          createdAt: at(DAY),
          updatedAt: at(DAY),
        })
        .returning();
      ids[rating] = row.id;
    }
    await db.insert(purchaseSatisfactions).values({
      orderId: `${prefix}-high-reason`,
      orderDisplayId: 99,
      userId: randomUUID(),
      rating: 4,
      reasons: ['OTHER'],
      createdAt: at(OTHER_DAY),
      updatedAt: at(OTHER_DAY),
    });
  });

  afterAll(async () => {
    await db.delete(purchaseSatisfactions).where(like(purchaseSatisfactions.orderId, `${prefix}%`));
    await end();
  });

  const mine = (rows: { orderId: string }[]) => rows.filter((r) => r.orderId.startsWith(prefix));

  it('목록 필터', async () => {
    const all = { limit: 100, from: DAY, to: DAY };
    expect((await reader.list({ ...all, score: 'low' })).total).toBe(3);
    expect((await reader.list({ ...all, score: 'high' })).total).toBe(2);
    expect((await reader.list({ ...all, hasMemo: true })).total).toBe(1);
    expect((await reader.list({ ...all, reason: 'PAYMENT_ERROR' })).total).toBe(1);
    expect((await reader.list({ ...all, unchecked: true })).total).toBe(4);
  });

  it('기간 구간은 KST 날짜 기준이다', async () => {
    expect((await reader.list({ limit: 100, from: DAY, to: DAY })).total).toBe(5);
    expect((await reader.list({ limit: 100, from: DAY, to: OTHER_DAY })).total).toBe(6);
    expect((await reader.list({ limit: 100, from: '2001-03-03', to: '2001-03-03' })).total).toBe(0);
  });

  it('요약 값이 맞다', async () => {
    const expected = {
      count: 5,
      average: 3,
      csatPercent: 40,
      uncheckedLow: 3,
      distribution: [1, 1, 1, 1, 1],
      reasonCounts: {
        ADDRESS_INPUT: 0,
        COUPON_DISCOUNT: 0,
        CASH_RECEIPT: 0,
        PAYMENT_METHOD: 0,
        PAYMENT_ERROR: 1,
        PRODUCT_SEARCH: 0,
        OTHER: 0,
      },
    };
    expect(await reader.summarize({ from: DAY, to: DAY })).toEqual(expected);
  });

  it('요약은 기간만 받고 점수·사유·메모·미확인 필터를 무시한다', async () => {
    const filtered = {
      from: DAY,
      to: DAY,
      score: 'high',
      reason: 'OTHER',
      hasMemo: true,
      unchecked: true,
    } as const;
    const base = await reader.summarize({ from: DAY, to: DAY });
    expect(await reader.summarize(filtered)).toEqual(base);
    expect(await reader.summarize({ from: DAY, to: DAY, unchecked: true } as const)).toEqual(base);
    expect(base.count).toBe(5);
  });

  it('요약 사유 집계는 3점 이하 응답만 센다', async () => {
    const s = await reader.summarize({ from: OTHER_DAY, to: OTHER_DAY });
    expect(s.count).toBe(1);
    expect(s.reasonCounts.OTHER).toBe(0);
  });

  it('빈 기간 요약은 0 이다', async () => {
    expect(await reader.summarize({ from: '2001-03-03', to: '2001-03-03' })).toMatchObject({
      count: 0,
      average: 0,
      csatPercent: 0,
      uncheckedLow: 0,
      distribution: [0, 0, 0, 0, 0],
    });
  });

  it('확인 처리와 해제', async () => {
    const on = await manager.setChecked(ids[2], true, admin);
    expect(on.checkedAt).toBeInstanceOf(Date);
    expect(on.checkedBy).toBe(admin);
    const off = await manager.setChecked(ids[2], false, admin);
    expect(off.checkedAt).toBeNull();
    expect(off.checkedBy).toBeNull();
  });
});
