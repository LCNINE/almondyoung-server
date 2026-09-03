import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { archivePageFavorites, archivePageVersions, archivePages, archiveSchema } from './schema/archive.schema';
import { ArchiveManager } from './archive.manager';
import { ArchiveReader } from './archive.reader';
import { ArchiveService } from './archive.service';

/**
 * 실 Postgres 로 검증한다 — 재귀 CTE(하위 트리), ILIKE 검색, 스페이스 가시성처럼
 * 검증 대상이 SQL 자체인 것들은 목으로 아무것도 확인하지 못한다.
 *
 * 실행:
 *   docker compose up -d postgres
 *   psql ... < apps/core/drizzle/<타임스탬프>_add-archive-pages.sql   # 스크래치 DB 준비
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_archive_itest \
 *     npx jest --testPathPattern="archive.integration"
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_ARCHIVE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_ARCHIVE_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('Archive (실 Postgres)', () => {
  jest.setTimeout(120_000);

  const alice = randomUUID();
  const bob = randomUUID();
  const createdIds: string[] = [];

  let sql: postgres.Sql;
  let dbService: DbService<typeof archiveSchema>;
  let reader: ArchiveReader;
  let manager: ArchiveManager;
  let service: ArchiveService;

  beforeAll(() => {
    const connect = (postgres as unknown as { default?: typeof postgres }).default ?? postgres;
    sql = connect(DATABASE_URL as string);
    const db = drizzle(sql, { schema: archiveSchema });

    dbService = {
      db,
      run: async (fn: (tx: unknown) => Promise<unknown>, tx?: unknown) => (tx ? fn(tx) : db.transaction(fn as never)),
    } as unknown as DbService<typeof archiveSchema>;

    reader = new ArchiveReader(dbService);
    manager = new ArchiveManager(dbService, reader);
    service = new ArchiveService(reader, manager);
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await dbService.db.delete(archivePageVersions).where(inArray(archivePageVersions.pageId, createdIds));
      await dbService.db.delete(archivePageFavorites).where(inArray(archivePageFavorites.pageId, createdIds));
      await dbService.db.delete(archivePages).where(inArray(archivePages.id, createdIds));
    }
    await sql.end();
  });

  /**
   * drizzle 이 원 에러를 «Failed query: …» 로 감싸므로 제약 이름은 cause 에 있다.
   * 어느 제약이 걸렸는지까지 봐야 «막히긴 했다»가 아니라 «의도한 것이 막았다»가 된다.
   */
  const expectConstraintViolation = async (run: () => Promise<unknown>, constraint: string): Promise<void> => {
    try {
      await run();
    } catch (error) {
      const cause = (error as { cause?: { constraint_name?: string } }).cause;
      expect(cause?.constraint_name).toBe(constraint);
      return;
    }
    throw new Error(`제약 ${constraint} 이 막았어야 하는데 통과했습니다`);
  };

  const track = <T extends { id: string }>(page: T): T => {
    createdIds.push(page.id);
    return page;
  };

  it('하위 페이지는 부모의 스페이스를 따른다', async () => {
    const parent = track(await manager.create({ space: 'private', title: '내 메모' }, alice));
    const child = track(await manager.create({ parentId: parent.id, title: '하위' }, alice));

    expect(child.space).toBe('private');
    expect(child.ownerId).toBe(alice);
  });

  it('남의 개인 페이지는 존재 자체가 보이지 않는다(404)', async () => {
    const mine = track(await manager.create({ space: 'private', title: '비밀' }, alice));

    await expect(reader.findAccessibleOrThrow(mine.id, bob)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reader.findAccessibleOrThrow(mine.id, alice)).resolves.toMatchObject({ id: mine.id });
  });

  it('팀 페이지는 다른 관리자도 본다', async () => {
    const shared = track(await manager.create({ space: 'team', title: '공용 매뉴얼' }, alice));

    await expect(reader.findAccessibleOrThrow(shared.id, bob)).resolves.toMatchObject({ id: shared.id });
  });

  it('삭제는 하위 트리까지 재귀로 내려간다', async () => {
    const root = track(await manager.create({ space: 'team', title: '뿌리' }, alice));
    const child = track(await manager.create({ parentId: root.id, title: '자식' }, alice));
    const grandchild = track(await manager.create({ parentId: child.id, title: '손자' }, alice));

    const removed = await manager.remove(root.id, alice);

    expect(new Set(removed)).toEqual(new Set([root.id, child.id, grandchild.id]));
    await expect(reader.findAccessibleOrThrow(grandchild.id, alice)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('복원할 때 부모가 아직 휴지통이면 스페이스 루트로 올라온다', async () => {
    const root = track(await manager.create({ space: 'team', title: '상위' }, alice));
    const child = track(await manager.create({ parentId: root.id, title: '하위' }, alice));

    await manager.remove(root.id, alice);
    const restored = await manager.restore(child.id, alice);

    expect(restored.parentId).toBeNull();
    expect(restored.deletedAt).toBeNull();
  });

  it('되돌리면 원래 순서 자리로 돌아간다 — 목록 맨 뒤로 밀리지 않는다', async () => {
    const marker = `복원${randomUUID().slice(0, 6)}`;
    const parent = track(await manager.create({ space: 'team', title: marker }, alice));
    const first = track(await manager.create({ parentId: parent.id, title: 'A' }, alice));
    const second = track(await manager.create({ parentId: parent.id, title: 'B' }, alice));
    const third = track(await manager.create({ parentId: parent.id, title: 'C' }, alice));

    const keyBefore = first.sortKey;
    await manager.remove(first.id, alice);
    const restored = await manager.restore(first.id, alice);

    expect(restored.sortKey).toBe(keyBefore);
    expect(restored.parentId).toBe(parent.id);

    const order = await reader.listSiblings(parent.id, 'team', null);
    expect(order.map((row) => row.id)).toEqual([first.id, second.id, third.id]);
  });

  it('자기 하위로는 옮길 수 없다', async () => {
    const root = track(await manager.create({ space: 'team', title: '이동원' }, alice));
    const child = track(await manager.create({ parentId: root.id, title: '이동대상' }, alice));

    await expect(manager.move(root.id, { parentId: child.id }, alice)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('형제 사이 이동이 실제로 순서를 바꾼다', async () => {
    const a = track(await manager.create({ space: 'team', title: `순서-a-${randomUUID().slice(0, 6)}` }, alice));
    const b = track(await manager.create({ space: 'team', title: `순서-b-${randomUUID().slice(0, 6)}` }, alice));
    const c = track(await manager.create({ space: 'team', title: `순서-c-${randomUUID().slice(0, 6)}` }, alice));

    const before = await reader.listSiblings(null, 'team', null);
    const target = before.findIndex((row) => row.id === a.id);
    // c 를 a 앞으로 보낸다.
    await manager.move(c.id, { parentId: null, position: target }, alice);

    const after = await reader.listSiblings(null, 'team', null);
    const indexOf = (id: string) => after.findIndex((row) => row.id === id);

    expect(indexOf(c.id)).toBeLessThan(indexOf(a.id));
    expect(indexOf(a.id)).toBeLessThan(indexOf(b.id));
  });

  it('본문 저장이 검색용 평문을 만들고 한글 부분일치로 찾힌다', async () => {
    const token = `입고마감${randomUUID().slice(0, 6)}`;
    const page = track(await manager.create({ space: 'team', title: '재고 정책' }, alice));

    await manager.update(
      page.id,
      { content: [{ type: 'paragraph', content: [{ type: 'text', text: `${token} 은 오후 3시` }] }] },
      alice,
    );

    const { hits } = await service.search(token.slice(0, 4), alice);

    expect(hits.map((hit) => hit.id)).toContain(page.id);
    expect(hits.find((hit) => hit.id === page.id)?.snippet).toContain(token);
  });

  it('검색은 남의 개인 문서를 넘겨주지 않는다', async () => {
    const token = `비밀어${randomUUID().slice(0, 6)}`;
    const secret = track(await manager.create({ space: 'private', title: token }, alice));

    await expect(service.search(token, alice)).resolves.toMatchObject({
      hits: [expect.objectContaining({ id: secret.id })],
      hasMore: false,
    });
    await expect(service.search(token, bob)).resolves.toMatchObject({ hits: [], hasMore: false });
  });

  it('작성자가 바뀌면 직전 상태가 스냅샷으로 남고 되돌릴 수 있다', async () => {
    const page = track(await manager.create({ space: 'team', title: '초안' }, alice));

    await manager.update(page.id, { content: [{ content: [{ text: '첫 번째' }] }], title: '1차' }, alice);
    await manager.update(page.id, { content: [{ content: [{ text: '두 번째' }] }], title: '2차' }, bob);

    // 스냅샷은 «고치기 직전» 상태다. 따라서 최신 스냅샷이 alice 가 쓴 1차 원고다.
    const versions = await reader.listVersions(page.id, 10);
    expect(versions.map((version) => version.title)).toEqual(['1차', '초안']);

    const firstDraft = versions[0];
    const restored = await manager.restoreVersion(page.id, firstDraft.id, alice);

    expect(restored.title).toBe('1차');
    // 되돌린 뒤에도 검색용 평문은 «되돌아간 본문»에서 다시 만들어져야 한다.
    expect(restored.searchText).toBe('첫 번째');
    // 되돌리기 직전 상태도 남아 있어야 되돌리기를 되돌릴 수 있다.
    const afterRestore = await reader.listVersions(page.id, 10);
    expect(afterRestore.map((version) => version.title)).toEqual(['2차', '1차', '초안']);
  });

  it('결과가 상한을 넘으면 잘렸다고 알려준다 — 잘린 개수를 전체처럼 주지 않는다', async () => {
    const token = `상한${randomUUID().slice(0, 6)}`;
    // 상한(30)보다 한 건 많게 만든다.
    for (let i = 0; i < 31; i += 1) {
      track(await manager.create({ space: 'team', title: `${token}-${i}` }, alice));
    }

    const result = await service.search(token, alice);

    expect(result.limit).toBe(30);
    expect(result.hits).toHaveLength(30);
    expect(result.hasMore).toBe(true);
  });

  it('결과가 상한 이하면 잘리지 않았다고 알려준다', async () => {
    const token = `소량${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 3; i += 1) {
      track(await manager.create({ space: 'team', title: `${token}-${i}` }, alice));
    }

    const result = await service.search(token, alice);

    expect(result.hits).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });

  it('휴지통에 없는 페이지는 영구 삭제되지 않는다', async () => {
    const page = track(await manager.create({ space: 'team', title: '살아있음' }, alice));

    await expect(manager.purge(page.id, alice)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('영구 삭제는 하위·스냅샷·즐겨찾기까지 지운다', async () => {
    const root = await manager.create({ space: 'team', title: '지울것' }, alice);
    const child = await manager.create({ parentId: root.id, title: '지울하위' }, alice);
    await manager.update(root.id, { content: [{ content: [{ text: '내용' }] }] }, alice);
    await manager.setFavorite(root.id, alice, true);
    await manager.remove(root.id, alice);

    const purged = await manager.purge(root.id, alice);

    expect(new Set(purged)).toEqual(new Set([root.id, child.id]));
    await expect(reader.findByIdOrNull(root.id)).resolves.toBeNull();
    await expect(reader.listVersions(root.id, 10)).resolves.toEqual([]);
    await expect(reader.listFavorites(alice)).resolves.toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: root.id })]),
    );
  });

  it('정렬 키는 DB 정렬과 자바스크립트 정렬이 «같은 답»을 낸다', async () => {
    // 이 DB 의 기본 콜레이션(en_US.utf8)에서는 'Zz' < 'a0' 가 거짓이다. 정렬 키 컬럼에
    // COLLATE "C" 를 걸지 않으면 «맨 앞으로 옮기기»가 DB 에서는 맨 뒤가 되어 화면과 갈라진다.
    const marker = `정렬${randomUUID().slice(0, 6)}`;
    const parent = track(await manager.create({ space: 'team', title: marker }, alice));

    const first = track(await manager.create({ parentId: parent.id, title: 'A' }, alice));
    const second = track(await manager.create({ parentId: parent.id, title: 'B' }, alice));
    // C 를 맨 앞으로 — 여기서 대문자 구간(Z…) 키가 만들어진다.
    const third = track(await manager.create({ parentId: parent.id, title: 'C' }, alice));
    await manager.move(third.id, { parentId: parent.id, position: 0 }, alice);

    const fromDb = await reader.listSiblings(parent.id, 'team', null);
    expect(fromDb.map((row) => row.id)).toEqual([third.id, first.id, second.id]);

    // 서버가 준 순서와, 클라이언트가 키만 보고 다시 정렬한 순서가 같아야 한다.
    const sortedInJs = [...fromDb].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    expect(sortedInJs.map((row) => row.id)).toEqual(fromDb.map((row) => row.id));
  });

  it('팀 문서에 주인을 달거나 개인 문서에서 주인을 빼면 DB 가 거부한다', async () => {
    const insert = (values: Record<string, unknown>) => () => dbService.db.insert(archivePages).values(values as never);

    await expectConstraintViolation(
      insert({ space: 'team', ownerId: alice, title: '어긋난 팀 문서', sortKey: 'a0' }),
      'ck_archive_pages_owner',
    );

    await expectConstraintViolation(
      insert({ space: 'private', ownerId: null, title: '주인 없는 개인 문서', sortKey: 'a0' }),
      'ck_archive_pages_owner',
    );
  });

  it('없는 스페이스 값은 DB 가 거부한다', async () => {
    await expectConstraintViolation(
      () =>
        dbService.db
          .insert(archivePages)
          .values({ space: 'public', ownerId: null, title: '이상한 스페이스', sortKey: 'a0' } as never),
      'ck_archive_pages_space',
    );
  });

  it('페이지 행을 지우면 하위·스냅샷·즐겨찾기가 FK 로 함께 사라진다', async () => {
    // 애플리케이션이 명시적으로 지우는 것과 별개로, DB 자체가 고아를 남기지 않아야 한다.
    const root = await manager.create({ space: 'team', title: 'FK 확인' }, alice);
    const child = await manager.create({ parentId: root.id, title: 'FK 하위' }, alice);
    await manager.update(root.id, { content: [{ content: [{ text: '내용' }] }] }, alice);
    await manager.setFavorite(root.id, alice, true);

    await dbService.db.delete(archivePages).where(inArray(archivePages.id, [root.id]));

    await expect(reader.findByIdOrNull(child.id)).resolves.toBeNull();
    await expect(reader.listVersions(root.id, 10)).resolves.toEqual([]);
    const favorites = await reader.listFavorites(alice);
    expect(favorites.map((row) => row.id)).not.toContain(root.id);
  });

  it('브레드크럼은 루트부터 부모까지 순서대로 온다', async () => {
    const root = track(await manager.create({ space: 'team', title: '1층' }, alice));
    const mid = track(await manager.create({ parentId: root.id, title: '2층' }, alice));
    const leaf = track(await manager.create({ parentId: mid.id, title: '3층' }, alice));

    const detail = await service.getPage(leaf.id, alice);

    expect(detail.breadcrumbs.map((crumb) => crumb.title)).toEqual(['1층', '2층']);
  });

  it('즐겨찾기는 사람마다 따로 쌓인다', async () => {
    const page = track(await manager.create({ space: 'team', title: '즐겨찾기 대상' }, alice));

    await manager.setFavorite(page.id, alice, true);
    // 같은 사람이 두 번 눌러도 행이 늘지 않아야 한다(unique 제약).
    await manager.setFavorite(page.id, alice, true);

    await expect(reader.isFavorite(page.id, alice)).resolves.toBe(true);
    await expect(reader.isFavorite(page.id, bob)).resolves.toBe(false);
    expect((await reader.listFavorites(alice)).filter((row) => row.id === page.id)).toHaveLength(1);
  });

  it('검색어에 든 와일드카드는 문자 그대로 다뤄진다', async () => {
    const marker = randomUUID().slice(0, 6);
    const withPercent = track(await manager.create({ space: 'team', title: `${marker}%정산` }, alice));
    const withoutPercent = track(await manager.create({ space: 'team', title: `${marker}X정산` }, alice));

    const ids = (await service.search('%정산', alice)).hits.map((hit) => hit.id);

    // '%' 를 이스케이프하지 않으면 패턴이 '%%정산%' 가 되어 «정산이 든 모든 문서»가 딸려 온다.
    expect(ids).toContain(withPercent.id);
    expect(ids).not.toContain(withoutPercent.id);
  });
});
