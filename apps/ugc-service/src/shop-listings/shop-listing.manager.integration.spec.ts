import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { shopListings } from '../db/schema';
import { type AutoDecisionPolicy } from './classifier/auto-decision';
import { NullShopListingClassifier, type ShopListingClassifier } from './classifier/shop-listing-classifier';
import { type AdminShopListingDto, type MemberShopListingDto } from './dto';
import { ShopListingModerationManager } from './shop-listing-moderation.manager';
import { ShopListingManager } from './shop-listing.manager';
import { ShopListingReader } from './shop-listing.reader';
import { cleanup, makeTestDb, type TestDrizzle } from './__tests__/shop-listing-test-db';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ugc \
 *   npx jest --runInBand --testPathPattern="shop-listing.manager.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const OFF: AutoDecisionPolicy = { enabled: false, approveThreshold: 0.9, rejectThreshold: 0.9 };

function memberDto(overrides: Partial<MemberShopListingDto> = {}): MemberShopListingDto {
  return {
    title: `강남 네일샵 ${randomUUID().slice(0, 8)}`,
    content: '역 5분 거리',
    region: 'seoul',
    businessType: 'nail',
    dealType: 'transfer',
    imageFileIds: [randomUUID(), randomUUID()],
    contactPhone: '01012345678',
    ...overrides,
  };
}

describeIfDb('ShopListingManager (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sqlClient: ReturnType<typeof makeTestDb>['sql'];
  let db: TestDrizzle;
  let t: ReturnType<typeof makeTestDb>;
  const authors: string[] = [];

  const build = (classifier: ShopListingClassifier = new NullShopListingClassifier(), policy = OFF) => {
    const reader = new ShopListingReader(t.dbService);
    const moderation = new ShopListingModerationManager(t.dbService, reader);
    return new ShopListingManager(t.dbService, reader, moderation, classifier, policy);
  };

  const newAuthor = () => {
    const id = randomUUID();
    authors.push(id);
    return id;
  };

  beforeAll(() => {
    t = makeTestDb(DATABASE_URL as string);
    sqlClient = t.sql;
    db = t.db;
  });

  afterAll(async () => {
    const rows = await db
      .select({ id: shopListings.id })
      .from(shopListings)
      .where(inArray(shopListings.authorUserId, authors));
    await cleanup(
      db,
      rows.map((r) => r.id),
    );
    await sqlClient.end();
  });

  it('회원 글은 v1 에서 pending 으로 들어가고 이미지 순서가 보존된다', async () => {
    const userId = newAuthor();
    const dto = memberDto();
    const created = await build().createByMember(dto, userId);

    expect(created).toMatchObject({ status: 'pending', authorType: 'member', authorUserId: userId });
    expect(created.imageFileIds).toEqual(dto.imageFileIds);
    expect(created.submittedAt).toBeInstanceOf(Date);
  });

  it('동시 게시 한도: 병렬 4건 → 3건만 성공', async () => {
    const userId = newAuthor();
    const manager = build();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => manager.createByMember(memberDto(), userId)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
  });

  it('남의 글은 수정·거래완료·삭제 모두 404', async () => {
    const owner = newAuthor();
    const other = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), owner);

    await expect(manager.updateByMember(created.id, memberDto(), other)).rejects.toThrow(NotFoundError);
    await expect(manager.closeByMember(created.id, other)).rejects.toThrow(NotFoundError);
    await expect(manager.deleteByMember(created.id, other)).rejects.toThrow(NotFoundError);
  });

  it('승인된 글을 회원이 고치면 pending 으로 내려가고 slug 는 그대로다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, created.id));

    const updated = await manager.updateByMember(created.id, memberDto({ title: '완전히 다른 제목' }), userId);

    expect(updated.status).toBe('pending');
    expect(updated.slug).toBe(created.slug);
    expect(updated.title).toBe('완전히 다른 제목');
  });

  it('숨김 글은 회원이 고칠 수 없지만 지울 수는 있다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'hidden' }).where(eq(shopListings.id, created.id));

    await expect(manager.updateByMember(created.id, memberDto(), userId)).rejects.toThrow(ConflictError);
    await expect(manager.deleteByMember(created.id, userId)).resolves.toBeUndefined();
  });

  it('회원이 지우면 연락처가 즉시 비워진다', async () => {
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto({ kakaoOpenChatUrl: 'https://open.kakao.com/o/x' }), userId);

    await manager.deleteByMember(created.id, userId);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, created.id));
    expect(row).toMatchObject({ contactPhone: null, kakaoOpenChatUrl: null, deletedBy: userId });
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it('거래완료 → 재개 시 한도를 검사한다', async () => {
    const userId = newAuthor();
    const manager = build();
    const first = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, first.id));
    await manager.closeByMember(first.id, userId);
    await manager.createByMember(memberDto(), userId);
    await manager.createByMember(memberDto(), userId);
    await manager.createByMember(memberDto(), userId);

    await expect(manager.reopenByMember(first.id, userId)).rejects.toThrow(ConflictError);
  });

  it('자동 판정이 켜져 있고 확신도가 높으면 바로 게시되고 이력이 남는다', async () => {
    const userId = newAuthor();
    const confident: ShopListingClassifier = {
      classify: () => Promise.resolve({ label: 'shop_listing', confidence: 0.99 }),
    };
    const created = await build(confident, { ...OFF, enabled: true }).createByMember(memberDto(), userId);

    expect(created.status).toBe('published');
  });

  it('관리자 글은 바로 published, 전화번호 없이도 된다', async () => {
    const adminId = newAuthor();
    const dto: AdminShopListingDto = {
      ...memberDto(),
      contactPhone: null,
      slug: `관리자-${randomUUID().slice(0, 8)}`,
    };
    const created = await build().createByAdmin(dto, adminId);

    expect(created).toMatchObject({ status: 'published', authorType: 'admin', slug: dto.slug, contactPhone: null });
  });

  it('관리자 수정은 상태를 바꾸지 않는다', async () => {
    const adminId = newAuthor();
    const userId = newAuthor();
    const manager = build();
    const created = await manager.createByMember(memberDto(), userId);

    const updated = await manager.updateByAdmin(created.id, memberDto({ title: '관리자가 고친 제목' }), adminId);

    expect(updated).toMatchObject({ status: 'pending', title: '관리자가 고친 제목', slug: created.slug });
  });

  it('탈퇴하면 그 회원의 글 전부 연락처가 비고 공개에서 빠진다 — 두 번 불러도 같다', async () => {
    const userId = newAuthor();
    const manager = build();
    const a = await manager.createByMember(memberDto(), userId);
    await db.update(shopListings).set({ status: 'published' }).where(eq(shopListings.id, a.id));

    expect(await manager.withdrawAuthor(userId)).toBe(1);
    await manager.withdrawAuthor(userId);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, a.id));
    expect(row).toMatchObject({ contactPhone: null, kakaoOpenChatUrl: null });
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  // 이관된 관리자 글은 author_user_id 에 그 직원의 id 를 들고 있다. 그 직원이 회원 화면으로 들어와도
  // 관리자 글은 「내 글」이 아니다 — 목록·조회·한도·삭제 모두에서 빠진다.
  it('같은 user id 의 관리자 글은 회원 쪽 조회·한도·삭제에서 빠진다', async () => {
    const staffId = newAuthor();
    const manager = build();
    const reader = new ShopListingReader(t.dbService);
    const adminIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      adminIds.push((await manager.createByAdmin({ ...memberDto(), contactPhone: null }, staffId)).id);
    }
    await db.update(shopListings).set({ status: 'pending' }).where(eq(shopListings.id, adminIds[0]));

    expect(await reader.listByAuthor(staffId)).toEqual([]);
    await expect(reader.findOwned(adminIds[0], staffId)).rejects.toThrow(NotFoundError);
    expect(await reader.countActiveByAuthor(staffId)).toBe(0);
    await expect(manager.deleteByMember(adminIds[0], staffId)).rejects.toThrow(NotFoundError);
    // 관리자 글 3건이 있어도 회원으로서 한도(3)에 걸리지 않는다
    await expect(manager.createByMember(memberDto(), staffId)).resolves.toMatchObject({ authorType: 'member' });

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, adminIds[0]));
    expect(row.deletedAt).toBeNull();
  });

  // 이관된 관리자 글은 author_user_id 에 그 직원의 id 를 들고 있다 — 직원이 탈퇴해도 관리자 글은 그대로다.
  it('탈퇴 처리는 같은 user id 의 관리자 글을 건드리지 않는다', async () => {
    const staffId = newAuthor();
    const manager = build();
    const adminListing = await manager.createByAdmin(
      { ...memberDto(), contactPhone: '01099998888', kakaoOpenChatUrl: 'https://open.kakao.com/o/staff' },
      staffId,
    );

    expect(await manager.withdrawAuthor(staffId)).toBe(0);

    const [row] = await db.select().from(shopListings).where(eq(shopListings.id, adminListing.id));
    expect(row).toMatchObject({
      authorType: 'admin',
      contactPhone: '01099998888',
      kakaoOpenChatUrl: 'https://open.kakao.com/o/staff',
      deletedAt: null,
    });
  });
});
