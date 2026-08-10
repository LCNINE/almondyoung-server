import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, like } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import type { DbTransaction } from '../../catalog.types';
import { SitePopupManager } from './site-popup.manager';
import { SitePopupReader } from './site-popup.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Database = PostgresJsDatabase<PimSchema>;

/** 통합 스펙은 Nest DI 를 거치지 않고 손으로 세운다 (저장소 관례). */
function dbServiceFor(database: Database): DbService<PimSchema> {
  return {
    db: database,
    run: (<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction) =>
      tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTransaction))) as never,
  } as unknown as DbService<PimSchema>;
}

describeIfDb('SitePopup 저장/조회 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  /** 이 스위트가 만든 행만 지우기 위한 제목 접두사 */
  const TITLE_PREFIX = `spec-popup-${randomUUID().slice(0, 8)}`;

  let client: postgres.Sql;
  let db: Database;
  let manager: SitePopupManager;
  let reader: SitePopupReader;
  let noticeId: string;

  beforeAll(async () => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: pimSchema });
    const dbService = dbServiceFor(db);
    reader = new SitePopupReader(dbService);
    manager = new SitePopupManager(dbService, reader);

    const [notice] = await db
      .insert(pimSchema.notices)
      .values({ title: `${TITLE_PREFIX}-notice`, content: '<p>본문</p>' })
      .returning({ id: pimSchema.notices.id });
    noticeId = notice.id;
  });

  afterAll(async () => {
    await db.delete(pimSchema.sitePopups).where(like(pimSchema.sitePopups.title, `${TITLE_PREFIX}%`));
    await db.delete(pimSchema.notices).where(eq(pimSchema.notices.id, noticeId));
    await client.end();
  });

  function title(name: string): string {
    return `${TITLE_PREFIX}-${name}`;
  }

  describe('CRUD 왕복', () => {
    it('등록한 값이 그대로 조회된다', async () => {
      const created = await manager.create({
        title: title('crud'),
        contentType: 'rich_text',
        content: '<p>여름 휴무 안내</p>',
        linkUrl: '/products',
        noticeId,
        pcWidth: 720,
        pcHeight: 520,
        mobileWidth: 320,
        mobileHeight: 380,
        placement: 'paths',
        placementPaths: ['/products', '/products'],
        audience: 'member',
        dismissMode: 'days',
        dismissDays: 7,
        sortOrder: 3,
      });

      const found = await reader.findById(created.id);

      expect(found).toMatchObject({
        content: '<p>여름 휴무 안내</p>',
        linkUrl: '/products',
        noticeId,
        pcWidth: 720,
        pcHeight: 520,
        mobileWidth: 320,
        mobileHeight: 380,
        placement: 'paths',
        placementPaths: ['/products'],
        audience: 'member',
        dismissMode: 'days',
        dismissDays: 7,
        dismissVersion: 1,
        isActive: true,
        sortOrder: 3,
      });
    });

    it('수정한 크기가 DB 에 남는다', async () => {
      const created = await manager.create({
        title: title('resize'),
        content: '<p>본문</p>',
        pcWidth: 460,
      });

      await manager.update(created.id, { pcWidth: 900, pcHeight: 640 });

      expect(await reader.findById(created.id)).toMatchObject({ pcWidth: 900, pcHeight: 640 });
    });

    it('숨김 초기화가 dismissVersion 을 올린다', async () => {
      const created = await manager.create({ title: title('reset'), content: '<p>본문</p>' });

      const after = await manager.resetDismissals(created.id);

      expect(after.dismissVersion).toBe(created.dismissVersion + 1);
    });

    it('삭제하면 조회에서 사라진다', async () => {
      const created = await manager.create({ title: title('delete'), content: '<p>본문</p>' });

      await manager.softDelete(created.id);

      await expect(reader.findById(created.id)).rejects.toThrow(NotFoundError);
      expect(await reader.findPublic('guest')).not.toContainEqual(
        expect.objectContaining({ id: created.id }),
      );
    });

    it('없는 팝업을 수정하면 404 다', async () => {
      await expect(manager.update(randomUUID(), { title: title('nope') })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('없는 공지를 연결하면 DB 제약 이전에 400 으로 막힌다', async () => {
      await expect(
        manager.create({ title: title('bad-notice'), content: '<p>본문</p>', noticeId: randomUUID() }),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('findPublic 노출 필터', () => {
    /** 이 블록이 만든 팝업만 보도록 id 로 걸러 확인한다. */
    async function publicIds(viewer: 'guest' | 'member' | 'membership'): Promise<string[]> {
      const rows = await reader.findPublic(viewer);
      return rows.map((row) => row.id);
    }

    it('방문자 구분에 맞는 대상만 내려준다', async () => {
      const all = await manager.create({ title: title('aud-all'), content: '<p>x</p>', audience: 'all' });
      const guest = await manager.create({
        title: title('aud-guest'),
        content: '<p>x</p>',
        audience: 'guest',
      });
      const member = await manager.create({
        title: title('aud-member'),
        content: '<p>x</p>',
        audience: 'member',
      });
      const membership = await manager.create({
        title: title('aud-membership'),
        content: '<p>x</p>',
        audience: 'membership',
      });

      const forGuest = await publicIds('guest');
      expect(forGuest).toEqual(expect.arrayContaining([all.id, guest.id]));
      expect(forGuest).not.toEqual(expect.arrayContaining([member.id, membership.id]));

      const forMember = await publicIds('member');
      expect(forMember).toEqual(expect.arrayContaining([all.id, member.id]));
      expect(forMember).not.toEqual(expect.arrayContaining([guest.id, membership.id]));

      // 멤버십 회원은 회원이기도 하므로 member 대상 팝업도 봐야 한다.
      const forMembership = await publicIds('membership');
      expect(forMembership).toEqual(expect.arrayContaining([all.id, member.id, membership.id]));
      expect(forMembership).not.toEqual(expect.arrayContaining([guest.id]));
    });

    it('게시 시작 전 팝업은 아직 내려주지 않는다', async () => {
      const future = await manager.create({
        title: title('scheduled'),
        content: '<p>x</p>',
        displayStartAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      expect(await publicIds('guest')).not.toContain(future.id);
    });

    it('게시 종료된 팝업은 내려주지 않는다', async () => {
      const ended = await manager.create({
        title: title('ended'),
        content: '<p>x</p>',
        displayStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        displayEndAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      });

      expect(await publicIds('guest')).not.toContain(ended.id);
    });

    it('게시 기간 안이면 내려준다', async () => {
      const live = await manager.create({
        title: title('live'),
        content: '<p>x</p>',
        displayStartAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        displayEndAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      expect(await publicIds('guest')).toContain(live.id);
    });

    it('비활성 팝업은 내려주지 않는다', async () => {
      const inactive = await manager.create({
        title: title('inactive'),
        content: '<p>x</p>',
        isActive: false,
      });

      expect(await publicIds('guest')).not.toContain(inactive.id);
    });

    it('sortOrder 오름차순으로 내려준다', async () => {
      const later = await manager.create({ title: title('order-b'), content: '<p>x</p>', sortOrder: 900 });
      const earlier = await manager.create({
        title: title('order-a'),
        content: '<p>x</p>',
        sortOrder: 800,
      });

      const ids = await publicIds('guest');
      expect(ids.indexOf(earlier.id)).toBeLessThan(ids.indexOf(later.id));
    });
  });

  describe('관리자 목록', () => {
    it('기본은 활성만, includeInactive 면 비활성도 함께 준다', async () => {
      const active = await manager.create({ title: title('list-active'), content: '<p>x</p>' });
      const inactive = await manager.create({
        title: title('list-inactive'),
        content: '<p>x</p>',
        isActive: false,
      });

      const defaults = await reader.findAll({ q: TITLE_PREFIX });
      expect(defaults.map((row) => row.id)).toEqual(expect.arrayContaining([active.id]));
      expect(defaults.map((row) => row.id)).not.toContain(inactive.id);

      const withInactive = await reader.findAll({ q: TITLE_PREFIX, includeInactive: true });
      expect(withInactive.map((row) => row.id)).toEqual(
        expect.arrayContaining([active.id, inactive.id]),
      );
    });

    it('삭제한 팝업은 관리자 목록에도 남지 않는다', async () => {
      const created = await manager.create({ title: title('list-deleted'), content: '<p>x</p>' });
      await manager.softDelete(created.id);

      const rows = await reader.findAll({ q: TITLE_PREFIX, includeInactive: true });
      expect(rows.map((row) => row.id)).not.toContain(created.id);
    });
  });

  describe('공지 연결', () => {
    it('연결한 공지를 지우면 팝업은 남고 연결만 끊긴다', async () => {
      const [throwaway] = await db
        .insert(pimSchema.notices)
        .values({ title: `${TITLE_PREFIX}-notice-tmp`, content: '<p>본문</p>' })
        .returning({ id: pimSchema.notices.id });

      const created = await manager.create({
        title: title('notice-link'),
        content: '<p>x</p>',
        noticeId: throwaway.id,
      });

      await db.delete(pimSchema.notices).where(inArray(pimSchema.notices.id, [throwaway.id]));

      expect(await reader.findById(created.id)).toMatchObject({ noticeId: null });
    });
  });
});
