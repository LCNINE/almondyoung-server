import { eq } from 'drizzle-orm';
import { shopListings } from '../db/schema';
import { ShopListingViewManager } from './shop-listing-view.manager';
import { cleanup, insertListing, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing-view.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShopListingViewManager (실 Postgres)', () => {
  const created: string[] = [];
  let t: ReturnType<typeof makeTestDb>;
  let db: TestDrizzle;
  let manager: ShopListingViewManager;

  beforeAll(() => {
    t = makeTestDb(DATABASE_URL as string);
    db = t.db;
    manager = new ShopListingViewManager(t.dbService);
  });

  afterAll(async () => {
    await cleanup(db, created);
    await t.sql.end();
  });

  const viewCount = async (id: string) =>
    (await db.select({ n: shopListings.viewCount }).from(shopListings).where(eq(shopListings.id, id)))[0].n;

  it('같은 방문자의 같은 날 재조회는 한 번만 센다', async () => {
    const id = await insertListing(db, { status: 'published' });
    created.push(id);
    const [{ slug }] = await db.select({ slug: shopListings.slug }).from(shopListings).where(eq(shopListings.id, id));

    await manager.recordView(slug, '1.2.3.4');
    await manager.recordView(slug, '1.2.3.4');
    await manager.recordView(slug, '5.6.7.8');

    expect(await viewCount(id)).toBe(2);
  });

  it('비공개 글은 세지 않는다', async () => {
    const id = await insertListing(db, { status: 'pending' });
    created.push(id);
    const [{ slug }] = await db.select({ slug: shopListings.slug }).from(shopListings).where(eq(shopListings.id, id));

    await manager.recordView(slug, '1.2.3.4');

    expect(await viewCount(id)).toBe(0);
  });

  it('없는 slug 는 조용히 무시한다 — 봇이 던진 경로로 404 를 만들지 않는다', async () => {
    await expect(manager.recordView('no-such-slug-xyz', '1.2.3.4')).resolves.toBeUndefined();
  });
});
