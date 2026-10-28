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

  beforeAll(async () => {
    const t = makeTestDb(DATABASE_URL as string);
    db = t.db;
    end = () => t.sql.end();
    manager = new PurchaseSatisfactionManager(t.dbService);
    reader = new PurchaseSatisfactionReader(t.dbService);
    await db.delete(purchaseSatisfactions).where(like(purchaseSatisfactions.orderId, `${prefix}%`));
    ids = {};
    for (const rating of [1, 2, 3, 4, 5]) {
      const row = await manager.upsert(`${prefix}-${rating}`, {
        userId: randomUUID(),
        orderDisplayId: rating,
        rating,
        ...(rating === 2 ? { reasons: ['PAYMENT_ERROR'], memo: '결제가 안 됐어요' } : {}),
      });
      ids[rating] = row.id;
    }
  });

  afterAll(async () => {
    await db.delete(purchaseSatisfactions).where(like(purchaseSatisfactions.orderId, `${prefix}%`));
    await end();
  });

  const mine = (rows: { orderId: string }[]) => rows.filter((r) => r.orderId.startsWith(prefix));

  it('목록 필터', async () => {
    const all = { limit: 100 };
    expect(mine((await reader.list({ ...all, score: 'low' })).data)).toHaveLength(3);
    expect(mine((await reader.list({ ...all, score: 'high' })).data)).toHaveLength(2);
    expect(mine((await reader.list({ ...all, hasMemo: true })).data)).toHaveLength(1);
    expect(mine((await reader.list({ ...all, reason: 'PAYMENT_ERROR' })).data)).toHaveLength(1);
    expect(mine((await reader.list({ ...all, unchecked: true })).data)).toHaveLength(5);
  });

  it('기간 구간은 KST 날짜 기준이다', async () => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const hit = await reader.list({ limit: 100, from: today, to: today });
    expect(mine(hit.data).length).toBe(5);
    const miss = await reader.list({ limit: 100, from: '2000-01-01', to: '2000-01-02' });
    expect(miss.total).toBe(0);
  });

  it('요약은 기간만 받고 점수·사유 필터는 무시한다', async () => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const empty = await reader.summarize({ from: '2000-01-01', to: '2000-01-02' });
    expect(empty).toMatchObject({
      count: 0,
      average: 0,
      csatPercent: 0,
      uncheckedLow: 0,
      distribution: [0, 0, 0, 0, 0],
    });

    const s = await reader.summarize({ from: today, to: today });
    expect(s.count).toBeGreaterThanOrEqual(5);
    expect(s.distribution).toHaveLength(5);
    expect(s.reasonCounts.PAYMENT_ERROR).toBeGreaterThanOrEqual(1);
    expect(Object.keys(s.reasonCounts)).toHaveLength(7);
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
