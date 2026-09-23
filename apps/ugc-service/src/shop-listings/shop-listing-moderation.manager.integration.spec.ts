import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { shopListingModerations, shopListings } from '../db/schema';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingReader } from './shop-listing.reader';
import { cleanup, insertListing, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing-moderation.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShopListingModerationManager (실 Postgres)', () => {
  jest.setTimeout(60_000);

  const adminId = randomUUID();
  const created: string[] = [];
  let sqlClient: ReturnType<typeof makeTestDb>['sql'];
  let db: TestDrizzle;
  let manager: ShopListingModerationManager;
  let reader: ShopListingReader;

  beforeAll(() => {
    const t = makeTestDb(DATABASE_URL as string);
    sqlClient = t.sql;
    db = t.db;
    reader = new ShopListingReader(t.dbService);
    manager = new ShopListingModerationManager(t.dbService, reader);
  });

  afterAll(async () => {
    await cleanup(db, created);
    await sqlClient.end();
  });

  const listing = async (status: 'pending' | 'published' | 'hidden' | 'closed' | 'rejected') => {
    const id = await insertListing(db, { status });
    created.push(id);
    return id;
  };

  const moderationsOf = (id: string) =>
    db.select().from(shopListingModerations).where(eq(shopListingModerations.listingId, id));

  it('승인하면 published 가 되고 관리자 판정이 스냅샷과 함께 남는다', async () => {
    const id = await listing('pending');
    const result = await manager.approve(id, adminId);

    expect(result.status).toBe('published');
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decidedBy: 'admin', decision: 'approved', actorUserId: adminId, titleSnapshot: '테스트 매물' });
  });

  it('거절하면 사유가 글과 이력 양쪽에 남는다', async () => {
    const id = await listing('pending');
    const result = await manager.reject(id, '연락처가 가짜입니다', adminId);

    expect(result).toMatchObject({ status: 'rejected', rejectReason: '연락처가 가짜입니다' });
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decision: 'rejected', reason: '연락처가 가짜입니다' });
  });

  it('숨김과 해제', async () => {
    const id = await listing('closed');
    expect((await manager.hide(id, adminId)).status).toBe('hidden');
    expect((await manager.unhide(id, adminId)).status).toBe('published');
    expect((await moderationsOf(id)).map((m) => m.decision).sort()).toEqual(['hidden', 'unhidden']);
  });

  it('허용되지 않는 전이는 409', async () => {
    const id = await listing('published');
    await expect(manager.approve(id, adminId)).rejects.toThrow(ConflictError);
  });

  it('삭제된 글은 404', async () => {
    const id = await listing('pending');
    await db.update(shopListings).set({ deletedAt: new Date() }).where(eq(shopListings.id, id));
    await expect(manager.approve(id, adminId)).rejects.toThrow(NotFoundError);
  });

  it('읽은 뒤 상태가 바뀌었으면 409 — 관리자 승인과 회원 수정이 겹치는 경우', async () => {
    const id = await listing('pending');
    await expect(
      db.transaction(async (trx) => {
        await manager.updateStatusGuarded(trx, id, 'published', { status: 'hidden' });
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('관리자가 본 판(expectedSubmittedAt)이 지금 글과 다르면 승인은 409 — 상태도 이력도 그대로', async () => {
    const id = await listing('pending');
    const stale = new Date(Date.now() - 60_000).toISOString();

    await expect(manager.approve(id, adminId, stale)).rejects.toThrow(ConflictError);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, id));
    expect(row.status).toBe('pending');
    expect(await moderationsOf(id)).toHaveLength(0);
  });

  it('거절도 같다 — 본 판이 다르면 409', async () => {
    const id = await listing('pending');
    const stale = new Date(Date.now() - 60_000).toISOString();
    await expect(manager.reject(id, '사유', adminId, stale)).rejects.toThrow(ConflictError);
    expect(await moderationsOf(id)).toHaveLength(0);
  });

  it('본 판이 지금 글과 같으면 승인된다', async () => {
    const id = await listing('pending');
    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, id));
    const result = await manager.approve(id, adminId, row.submittedAt?.toISOString());
    expect(result.status).toBe('published');
  });

  it('읽은 뒤 회원이 pending 글을 고쳤으면(pending → pending) submitted_at CAS 가 409 로 막는다', async () => {
    const id = await listing('pending');
    const [before] = await db.select().from(shopListings).where(eq(shopListings.id, id));
    const readSubmittedAt = before.submittedAt;

    await expect(
      db.transaction(async (trx) => {
        const current = await reader.findForAdmin(id, trx);
        expect(current.submittedAt?.getTime()).toBe(readSubmittedAt?.getTime());
        // 다른 연결에서 회원 수정이 커밋된다 — 상태는 pending 그대로, 제출 시각만 바뀐다.
        await db
          .update(shopListings)
          .set({ title: '고친 제목', submittedAt: new Date(Date.now() + 1_000) })
          .where(eq(shopListings.id, id));
        await manager.updateStatusGuarded(trx, id, 'pending', { status: 'published' }, { submittedAt: readSubmittedAt });
      }),
    ).rejects.toThrow(ConflictError);

    const [after] = await db.select().from(shopListings).where(eq(shopListings.id, id));
    expect(after.status).toBe('pending');
  });

  it('판정기 결과가 없으면 이력을 남기지 않는다', async () => {
    const id = await listing('pending');
    await db.transaction((trx) => manager.recordClassification(trx, { id, title: 't', content: 'c' }, null, 'pending'));
    expect(await moderationsOf(id)).toHaveLength(0);
  });

  it('판정기 결과는 라벨·확신도와 함께 남는다 — 섀도 모드의 정답셋', async () => {
    const id = await listing('pending');
    await db.transaction((trx) =>
      manager.recordClassification(
        trx,
        { id, title: 't', content: 'c' },
        { label: 'shop_listing', confidence: 0.42 },
        'pending',
      ),
    );
    const [m] = await moderationsOf(id);
    expect(m).toMatchObject({ decidedBy: 'classifier', decision: 'pending', label: 'shop_listing' });
    expect(m.confidence).toBeCloseTo(0.42);
  });
});
