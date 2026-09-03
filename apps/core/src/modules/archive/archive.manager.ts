import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { archivePageFavorites, archivePageVersions, archivePages } from './schema/archive.schema';
import type { ArchivePage, ArchiveSpace } from './schema/archive.schema';
import type { ArchiveSchema, ArchiveTx } from './archive.types';
import { ArchiveReader } from './archive.reader';
import { ownerForSpace } from './archive-scope';
import { extractPlainText } from './archive-content';
import { generateKeyAfter, generateKeyBetween } from './sort-key';
import { CreateArchivePageDto, MoveArchivePageDto, UpdateArchivePageDto } from './dto/archive-page.dto';

/** 자동 저장마다 스냅샷을 남기면 폭증한다 — 같은 사람이 연속 편집하는 동안은 한 개로 묶는다. */
const VERSION_MIN_INTERVAL_MS = 10 * 60 * 1000;
/** 페이지당 보관할 스냅샷 수. 넘치면 오래된 것부터 지운다. */
const VERSION_KEEP_COUNT = 50;
/** 본문 jsonb 상한. 편집기 한 페이지가 이 크기를 넘으면 문서를 쪼개야 하는 상태다. */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

@Injectable()
export class ArchiveManager {
  constructor(
    @InjectDb() private readonly db: DbService<ArchiveSchema>,
    private readonly reader: ArchiveReader,
  ) {}

  async create(dto: CreateArchivePageDto, actorId: string, tx?: ArchiveTx): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      let space: ArchiveSpace = dto.space ?? 'team';
      let parentId: string | null = null;

      if (dto.parentId) {
        const parent = await this.reader.findAccessibleOrThrow(dto.parentId, actorId, {}, trx);
        // 스페이스는 부모를 따른다 — 팀 문서 밑에 개인 문서가 섞이면 권한이 갈라진다.
        space = parent.space;
        parentId = parent.id;
      }

      const ownerId = ownerForSpace(space, actorId);
      const sortKey = await this.nextSortKey(parentId, space, ownerId, trx);

      const [created] = await trx
        .insert(archivePages)
        .values({
          parentId,
          space,
          ownerId,
          title: dto.title ?? '',
          icon: dto.icon ?? null,
          sortKey,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning();

      if (!created) throw new Error('archive: insert returned no row');
      return created;
    }, tx);
  }

  async update(id: string, dto: UpdateArchivePageDto, actorId: string, tx?: ArchiveTx): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      const page = await this.reader.findAccessibleOrThrow(id, actorId, {}, trx);

      const contentChanged = dto.content !== undefined;
      const titleChanged = dto.title !== undefined && dto.title !== page.title;

      if (contentChanged) {
        const bytes = Buffer.byteLength(JSON.stringify(dto.content ?? []), 'utf8');
        if (bytes > MAX_CONTENT_BYTES) {
          throw new BadRequestError('본문이 너무 큽니다. 페이지를 나눠 주세요.');
        }
      }

      if (contentChanged || titleChanged) {
        await this.snapshotIfDue(page, actorId, trx);
      }

      const patch: Partial<typeof archivePages.$inferInsert> = {
        updatedBy: actorId,
        updatedAt: new Date(),
      };

      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.icon !== undefined) patch.icon = dto.icon || null;
      if (dto.coverUrl !== undefined) patch.coverUrl = dto.coverUrl || null;
      if (dto.content !== undefined) {
        patch.content = dto.content;
        patch.searchText = extractPlainText(dto.content);
      }
      if (dto.contentMarkdown !== undefined) patch.contentMarkdown = dto.contentMarkdown;

      const [updated] = await trx.update(archivePages).set(patch).where(eq(archivePages.id, id)).returning();

      if (!updated) throw new NotFoundError(`Archive page not found: ${id}`);
      return updated;
    }, tx);
  }

  async move(id: string, dto: MoveArchivePageDto, actorId: string, tx?: ArchiveTx): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      const page = await this.reader.findAccessibleOrThrow(id, actorId, {}, trx);
      const nextParentId = dto.parentId ?? null;

      if (nextParentId === id) {
        throw new BadRequestError('페이지를 자기 자신 밑으로 옮길 수 없습니다.');
      }

      if (nextParentId) {
        const parent = await this.reader.findAccessibleOrThrow(nextParentId, actorId, {}, trx);
        if (parent.space !== page.space || parent.ownerId !== page.ownerId) {
          throw new BadRequestError('다른 스페이스로는 옮길 수 없습니다.');
        }

        const subtree = await this.reader.listSubtreeIds(id, trx);
        if (subtree.includes(nextParentId)) {
          throw new BadRequestError('페이지를 자기 하위 페이지 밑으로 옮길 수 없습니다.');
        }
      }

      const siblings = (await this.reader.listSiblings(nextParentId, page.space, page.ownerId, trx)).filter(
        (sibling) => sibling.id !== id,
      );

      // 어느 «두 이웃 사이»인지만 정하면 이동은 UPDATE 한 줄로 끝난다.
      const position = clamp(dto.position ?? siblings.length, 0, siblings.length);
      const before = position === 0 ? null : siblings[position - 1].sortKey;
      const after = position === siblings.length ? null : siblings[position].sortKey;

      const [moved] = await trx
        .update(archivePages)
        .set({
          parentId: nextParentId,
          sortKey: generateKeyBetween(before, after),
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(eq(archivePages.id, id))
        .returning();

      if (!moved) throw new NotFoundError(`Archive page not found: ${id}`);
      return moved;
    }, tx);
  }

  /** 소프트 삭제 — 하위 페이지까지 함께 휴지통으로 간다. */
  async remove(id: string, actorId: string, tx?: ArchiveTx): Promise<string[]> {
    return this.db.run(async (trx) => {
      await this.reader.findAccessibleOrThrow(id, actorId, {}, trx);
      const ids = await this.reader.listSubtreeIds(id, trx);

      await trx
        .update(archivePages)
        .set({ deletedAt: new Date(), deletedBy: actorId })
        .where(and(inArray(archivePages.id, ids), isNull(archivePages.deletedAt)));

      return ids;
    }, tx);
  }

  /**
   * 휴지통에서 복원.
   *
   * 갈 자리가 그대로 있으면 «원래 자리»로 돌려놓는다 — 부모도 정렬 키도 건드리지 않는다.
   * 되돌렸는데 목록 맨 아래에 가 있으면 그건 복원이 아니라 재생성처럼 보인다.
   * 부모가 아직 휴지통에 있을 때만 갈 곳이 없으므로 스페이스 루트로 올리고, 그때만 새 키를 준다.
   */
  async restore(id: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      const page = await this.reader.findAccessibleOrThrow(id, actorId, { includeDeleted: true }, trx);
      if (!page.deletedAt) return page;

      const ids = await this.reader.listSubtreeIds(id, trx);
      await trx.update(archivePages).set({ deletedAt: null, deletedBy: null }).where(inArray(archivePages.id, ids));

      const parent = page.parentId ? await this.reader.findByIdOrNull(page.parentId, trx) : null;
      const parentIsGone = Boolean(page.parentId) && (!parent || Boolean(parent.deletedAt));

      const patch: Partial<typeof archivePages.$inferInsert> = {
        updatedBy: actorId,
        updatedAt: new Date(),
      };

      if (parentIsGone) {
        patch.parentId = null;
        patch.sortKey = await this.nextSortKey(null, page.space, page.ownerId, trx);
      }

      const [restored] = await trx
        .update(archivePages)
        .set(patch)
        .where(eq(archivePages.id, id))
        .returning();

      if (!restored) throw new NotFoundError(`Archive page not found: ${id}`);
      return restored;
    }, tx);
  }

  /** 영구 삭제 — 하위 페이지·스냅샷·즐겨찾기까지 지운다. */
  async purge(id: string, actorId: string, tx?: ArchiveTx): Promise<string[]> {
    return this.db.run(async (trx) => {
      const page = await this.reader.findAccessibleOrThrow(id, actorId, { includeDeleted: true }, trx);
      if (!page.deletedAt) {
        throw new BadRequestError('휴지통에 있는 페이지만 영구 삭제할 수 있습니다.');
      }

      const ids = await this.reader.listSubtreeIds(id, trx);
      await trx.delete(archivePageVersions).where(inArray(archivePageVersions.pageId, ids));
      await trx.delete(archivePageFavorites).where(inArray(archivePageFavorites.pageId, ids));
      await trx.delete(archivePages).where(inArray(archivePages.id, ids));

      return ids;
    }, tx);
  }

  async setFavorite(id: string, actorId: string, favorite: boolean, tx?: ArchiveTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      await this.reader.findAccessibleOrThrow(id, actorId, {}, trx);

      if (favorite) {
        await trx.insert(archivePageFavorites).values({ pageId: id, userId: actorId }).onConflictDoNothing();
      } else {
        await trx
          .delete(archivePageFavorites)
          .where(and(eq(archivePageFavorites.pageId, id), eq(archivePageFavorites.userId, actorId)));
      }

      return favorite;
    }, tx);
  }

  /** 지난 스냅샷으로 되돌린다. 되돌리기 직전 상태도 스냅샷으로 남겨 되돌리기를 되돌릴 수 있게 한다. */
  async restoreVersion(id: string, versionId: string, actorId: string, tx?: ArchiveTx): Promise<ArchivePage> {
    return this.db.run(async (trx) => {
      const page = await this.reader.findAccessibleOrThrow(id, actorId, {}, trx);
      const version = await this.reader.findVersionOrThrow(id, versionId, trx);

      await this.snapshot(page, actorId, trx);

      const [updated] = await trx
        .update(archivePages)
        .set({
          title: version.title,
          content: version.content,
          contentMarkdown: version.contentMarkdown,
          searchText: extractPlainText(version.content),
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(eq(archivePages.id, id))
        .returning();

      if (!updated) throw new NotFoundError(`Archive page not found: ${id}`);
      return updated;
    }, tx);
  }

  private async snapshotIfDue(page: ArchivePage, actorId: string, tx: ArchiveTx): Promise<void> {
    const latest = await this.reader.latestVersion(page.id, tx);

    if (latest) {
      const sameAuthor = latest.authorId === actorId;
      const age = Date.now() - latest.createdAt.getTime();
      if (sameAuthor && age < VERSION_MIN_INTERVAL_MS) return;
    }

    await this.snapshot(page, actorId, tx);
  }

  private async snapshot(page: ArchivePage, actorId: string, tx: ArchiveTx): Promise<void> {
    await tx.insert(archivePageVersions).values({
      pageId: page.id,
      title: page.title,
      content: page.content,
      contentMarkdown: page.contentMarkdown,
      authorId: actorId,
    });

    await this.pruneVersions(page.id, tx);
  }

  private async pruneVersions(pageId: string, tx: ArchiveTx): Promise<void> {
    const keep = await tx
      .select({ id: archivePageVersions.id })
      .from(archivePageVersions)
      .where(eq(archivePageVersions.pageId, pageId))
      .orderBy(desc(archivePageVersions.createdAt))
      .limit(VERSION_KEEP_COUNT);

    if (keep.length < VERSION_KEEP_COUNT) return;

    await tx.delete(archivePageVersions).where(
      and(
        eq(archivePageVersions.pageId, pageId),
        notInArray(
          archivePageVersions.id,
          keep.map((row) => row.id),
        ),
      ),
    );
  }

  /** 형제 목록 맨 뒤에 붙일 키. 형제가 없으면 첫 키. */
  private async nextSortKey(
    parentId: string | null,
    space: ArchiveSpace,
    ownerId: string | null,
    tx: ArchiveTx,
  ): Promise<string> {
    const siblings = await this.reader.listSiblings(parentId, space, ownerId, tx);
    return generateKeyAfter(siblings.at(-1)?.sortKey ?? null);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
