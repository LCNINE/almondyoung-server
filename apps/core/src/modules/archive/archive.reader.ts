import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { RowList } from 'postgres';
import { archivePageFavorites, archivePageVersions, archivePages } from './schema/archive.schema';
import type { ArchivePage, ArchivePageVersion, ArchiveSpace } from './schema/archive.schema';
import type { ArchiveSchema, ArchiveTx } from './archive.types';
import { notDeleted, visibleToActor } from './archive-scope';

/** 부모를 거슬러 올라가다 데이터가 순환하면 멈추기 위한 상한. */
const MAX_ANCESTOR_DEPTH = 64;

/** 트리·브레드크럼을 그리는 데 필요한 최소 컬럼. 본문(jsonb)은 절대 싣지 않는다. */
export type ArchiveNodeRow = {
  id: string;
  parentId: string | null;
  space: ArchiveSpace;
  title: string;
  icon: string | null;
  sortKey: string;
  updatedAt: Date;
};

export type ArchiveTrashRow = ArchiveNodeRow & {
  deletedAt: Date | null;
  deletedBy: string | null;
};

@Injectable()
export class ArchiveReader {
  constructor(@InjectDb() private readonly db: DbService<ArchiveSchema>) {}

  private nodeColumns() {
    return {
      id: archivePages.id,
      parentId: archivePages.parentId,
      space: archivePages.space,
      title: archivePages.title,
      icon: archivePages.icon,
      sortKey: archivePages.sortKey,
      updatedAt: archivePages.updatedAt,
    };
  }

  async findByIdOrNull(id: string, tx?: ArchiveTx): Promise<ArchivePage | null> {
    return this.db.run(async (trx) => {
      const [page] = await trx.select().from(archivePages).where(eq(archivePages.id, id)).limit(1);
      return page ?? null;
    }, tx);
  }

  /**
   * 접근 권한이 없으면 404 로 돌려준다 — 남의 개인 페이지는 존재 자체가 드러나면 안 된다.
   * (403 은 "그 id 의 문서가 있다"는 사실을 알려준다.)
   */
  async findAccessibleOrThrow(
    id: string,
    actorId: string,
    options: { includeDeleted?: boolean } = {},
    tx?: ArchiveTx,
  ): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [eq(archivePages.id, id), visibleToActor(actorId)];
      if (!options.includeDeleted) conditions.push(notDeleted());

      const [page] = await trx
        .select()
        .from(archivePages)
        .where(and(...conditions))
        .limit(1);

      if (!page) throw new NotFoundError(`Archive page not found: ${id}`);
      return page;
    }, tx);
  }

  /**
   * 한 스페이스의 살아있는 페이지 전체를 평면으로 돌려준다. 트리 조립은 호출자 몫이다.
   *
   * 본문을 뺀 목록이라 행 하나가 100바이트 남짓이고, 사내 문서 규모(수천 건)에서는
   * 한 번에 받는 편이 사이드바 반응이 빠르다. 페이지가 5,000건을 넘어가면
   * 자식 지연 로딩으로 바꿔야 한다 — 그 전까지는 이 한 방이 더 싸다.
   */
  async listSpaceNodes(space: ArchiveSpace, actorId: string, tx?: ArchiveTx): Promise<ArchiveNodeRow[]> {
    return this.db.run(async (trx) => {
      const scope =
        space === 'team'
          ? eq(archivePages.space, 'team')
          : and(eq(archivePages.space, 'private'), eq(archivePages.ownerId, actorId));

      return trx
        .select(this.nodeColumns())
        .from(archivePages)
        .where(and(scope, notDeleted()))
        .orderBy(asc(archivePages.sortKey), asc(archivePages.id));
    }, tx);
  }

  /**
   * 한 페이지의 조상만 거슬러 올라간다(루트 → 부모 순서). 깊이만큼의 인덱스 조회라
   * 보통 2~4번이면 끝난다 — 검색처럼 여러 건을 한꺼번에 그릴 때만 loadAncestryIndex 를 쓴다.
   */
  async listAncestors(page: { parentId: string | null }, actorId: string, tx?: ArchiveTx): Promise<ArchiveNodeRow[]> {
    return this.db.run(async (trx) => {
      const trail: ArchiveNodeRow[] = [];
      const seen = new Set<string>();
      let cursor = page.parentId;

      while (cursor && trail.length < MAX_ANCESTOR_DEPTH && !seen.has(cursor)) {
        seen.add(cursor);
        const [row] = await trx
          .select(this.nodeColumns())
          .from(archivePages)
          .where(and(eq(archivePages.id, cursor), visibleToActor(actorId), notDeleted()))
          .limit(1);

        if (!row) break;
        trail.push(row);
        cursor = row.parentId;
      }

      return trail.reverse();
    }, tx);
  }

  /** 브레드크럼·검색 결과 경로를 메모리에서 만들기 위한 조상 색인. 본문은 싣지 않는다. */
  async loadAncestryIndex(actorId: string, tx?: ArchiveTx): Promise<Map<string, ArchiveNodeRow>> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .select(this.nodeColumns())
        .from(archivePages)
        .where(and(visibleToActor(actorId), notDeleted()));

      return new Map(rows.map((row) => [row.id, row]));
    }, tx);
  }

  /**
   * 제목·본문 평문에 대한 부분일치 검색.
   *
   * 한국어는 Postgres 기본 사전이 형태소를 모르므로 to_tsvector 가 "재고관리" 를
   * "재고" 로 찾아주지 못한다. 그래서 1라운드는 ILIKE 부분일치다 — 인덱스를 타지 않아
   * 문서 수에 선형이고, 사내 문서 규모에서만 성립하는 선택이다.
   * 승격 경로: pg_trgm GIN 인덱스, 그다음 apps/search(OpenSearch) 색인.
   *
   * 상한보다 한 건 더 읽는다 — 그래야 «상한에 걸렸을 뿐인지»를 호출자가 알 수 있고,
   * 화면이 잘린 개수를 전체 건수처럼 보여주지 않는다.
   */
  async search(query: string, actorId: string, limit: number, tx?: ArchiveTx): Promise<ArchivePage[]> {
    return this.db.run(async (trx) => {
      const pattern = `%${escapeLike(query)}%`;
      const match = or(
        sql`${archivePages.title} ILIKE ${pattern} ESCAPE '\\'`,
        sql`${archivePages.searchText} ILIKE ${pattern} ESCAPE '\\'`,
      );
      if (!match) throw new Error('archive: search predicate could not be built');

      return trx
        .select()
        .from(archivePages)
        .where(and(visibleToActor(actorId), notDeleted(), match))
        .orderBy(desc(archivePages.updatedAt))
        .limit(limit + 1);
    }, tx);
  }

  /** 휴지통에 있는 모든 행. 어느 것이 삭제의 뿌리인지는 호출자가 부모 관계로 판정한다. */
  async listDeleted(actorId: string, tx?: ArchiveTx): Promise<ArchiveTrashRow[]> {
    return this.db.run(async (trx) => {
      return trx
        .select({ ...this.nodeColumns(), deletedAt: archivePages.deletedAt, deletedBy: archivePages.deletedBy })
        .from(archivePages)
        .where(and(visibleToActor(actorId), isNotNull(archivePages.deletedAt)))
        .orderBy(desc(archivePages.deletedAt));
    }, tx);
  }

  async listFavorites(actorId: string, tx?: ArchiveTx): Promise<ArchiveNodeRow[]> {
    return this.db.run(async (trx) => {
      return trx
        .select(this.nodeColumns())
        .from(archivePageFavorites)
        .innerJoin(archivePages, eq(archivePages.id, archivePageFavorites.pageId))
        .where(and(eq(archivePageFavorites.userId, actorId), visibleToActor(actorId), notDeleted()))
        .orderBy(desc(archivePageFavorites.createdAt));
    }, tx);
  }

  async isFavorite(pageId: string, actorId: string, tx?: ArchiveTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ id: archivePageFavorites.id })
        .from(archivePageFavorites)
        .where(and(eq(archivePageFavorites.pageId, pageId), eq(archivePageFavorites.userId, actorId)))
        .limit(1);
      return Boolean(row);
    }, tx);
  }

  async listRecent(actorId: string, limit: number, tx?: ArchiveTx): Promise<ArchiveNodeRow[]> {
    return this.db.run(async (trx) => {
      return trx
        .select(this.nodeColumns())
        .from(archivePages)
        .where(and(visibleToActor(actorId), notDeleted()))
        .orderBy(desc(archivePages.updatedAt))
        .limit(limit);
    }, tx);
  }

  async listVersions(pageId: string, limit: number, tx?: ArchiveTx): Promise<ArchivePageVersion[]> {
    return this.db.run(async (trx) => {
      return trx
        .select()
        .from(archivePageVersions)
        .where(eq(archivePageVersions.pageId, pageId))
        .orderBy(desc(archivePageVersions.createdAt))
        .limit(limit);
    }, tx);
  }

  async findVersionOrThrow(pageId: string, versionId: string, tx?: ArchiveTx): Promise<ArchivePageVersion> {
    return this.db.run(async (trx) => {
      const [version] = await trx
        .select()
        .from(archivePageVersions)
        .where(and(eq(archivePageVersions.id, versionId), eq(archivePageVersions.pageId, pageId)))
        .limit(1);

      if (!version) throw new NotFoundError(`Archive page version not found: ${versionId}`);
      return version;
    }, tx);
  }

  async latestVersion(pageId: string, tx?: ArchiveTx): Promise<ArchivePageVersion | null> {
    const [version] = await this.listVersions(pageId, 1, tx);
    return version ?? null;
  }

  /** 형제(같은 부모·같은 스페이스) 목록. 정렬 재부여에 쓴다. */
  async listSiblings(
    parentId: string | null,
    space: ArchiveSpace,
    ownerId: string | null,
    tx?: ArchiveTx,
  ): Promise<Array<{ id: string; sortKey: string }>> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [
        parentId === null ? isNull(archivePages.parentId) : eq(archivePages.parentId, parentId),
        eq(archivePages.space, space),
        ownerId === null ? isNull(archivePages.ownerId) : eq(archivePages.ownerId, ownerId),
        notDeleted(),
      ];

      return trx
        .select({ id: archivePages.id, sortKey: archivePages.sortKey })
        .from(archivePages)
        .where(and(...conditions))
        .orderBy(asc(archivePages.sortKey), asc(archivePages.id));
    }, tx);
  }

  /** 자기 자신을 포함한 하위 트리 전체의 id. 삭제·복원·순환 검사에 쓴다. */
  async listSubtreeIds(rootId: string, tx?: ArchiveTx): Promise<string[]> {
    return this.db.run(async (trx) => {
      const recursive = sql`
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM ${archivePages}
          WHERE id = ${rootId}

          UNION ALL

          SELECT p.id
          FROM ${archivePages} p
          INNER JOIN subtree s ON p.parent_id = s.id
        )
        SELECT id FROM subtree
      `;

      const result = await trx.execute(recursive);
      const rows = result as RowList<{ id: string }[]>;
      return rows.map((row) => row.id);
    }, tx);
  }
}

/** ILIKE 패턴에서 사용자 입력의 와일드카드를 문자 그대로 만든다. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
