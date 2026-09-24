import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
import { PaginatedResponseDto } from '@app/shared/dto';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  logoContestEntries,
  logoContestEntryMedia,
  logoContestVotes,
  type UgcServiceSchema,
  type UgcTx,
} from '../../db/schema';
import {
  LOGO_CONTEST_TOP_LIMIT,
  MAX_LOGO_CONTEST_MEDIA_COUNT,
  MIN_LOGO_CONTEST_MEDIA_COUNT,
  type LogoContestEntryStatus,
} from '../constants/logo-contest.constants';
import {
  AdminLogoContestEntryListQueryDto,
  CreateLogoContestEntryDto,
  LogoContestEntryListQueryDto,
} from '../dto/logo-contest.dto';
import { AlreadySubmittedError } from '../errors/already-submitted.error';
import { FileOwnerClient } from '../clients/file-owner.client';
import { LogoContestPeriodService } from './logo-contest-period.service';
import type { LogoContestEntryWithVotes } from '../types/logo-contest.types';

// 현재 조회중인 출품작에 달린 득표수가 몇개인가?
// 작품을 가져오면서 득표수도 함께 보여주고 인기순으로 정렬하려고 이렇게 작성함
const voteCountSql = sql<number>`(
  select count(*)::int from ${logoContestVotes} where ${logoContestVotes.entryId} = "logo_contest_entries"."id"
)`;

const UNIQUE_VIOLATION = '23505';
const ENTRY_USER_UNIQUE_INDEX = 'logo_contest_entries_user_unique';

/**
 * drizzle 이 driver 에러를 감싸므로 postgres.js 의 code·constraint_name 은 최상위가 아니라
 * `.cause` 체인에 있다. 최상위만 보면 동시 출품이 409 가 아니라 500 으로 샌다.
 */
function isDuplicateEntry(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const row = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (row.code === UNIQUE_VIOLATION && row.constraint_name === ENTRY_USER_UNIQUE_INDEX) {
      return true;
    }
    current = row.cause;
  }

  return false;
}

@Injectable()
export class LogoContestService {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly period: LogoContestPeriodService,
    private readonly fileOwner: FileOwnerClient,
  ) {}

  async listVisible(query: LogoContestEntryListQueryDto): Promise<PaginatedResponseDto<LogoContestEntryWithVotes>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = this.period.isClosed() ? 'popular' : (query.sort ?? 'latest');

    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(this.visibleCondition())
        // 대상은 늘 맨 위다. 마감 전에는 대상이 없어 이 절이 아무 일도 하지 않는다.
        .orderBy(
          desc(logoContestEntries.isWinner),
          ...(sort === 'popular'
            ? [desc(voteCountSql), asc(logoContestEntries.createdAt), asc(logoContestEntries.id)]
            : [desc(logoContestEntries.createdAt), desc(logoContestEntries.id)]),
        )
        .limit(limit)
        .offset((page - 1) * limit);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(logoContestEntries)
        .where(this.visibleCondition());

      return { data: await this.attachMedia(rows, tx), total, page, limit };
    });
  }

  async listTop(limit = LOGO_CONTEST_TOP_LIMIT): Promise<LogoContestEntryWithVotes[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(this.visibleCondition())
        .orderBy(
          desc(logoContestEntries.isWinner),
          desc(voteCountSql),
          asc(logoContestEntries.createdAt),
          asc(logoContestEntries.id),
        )
        .limit(limit);

      return this.attachMedia(rows, tx);
    });
  }

  async getVisible(id: string): Promise<LogoContestEntryWithVotes> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.id, id), this.visibleCondition()));

      const [entry] = await this.attachMedia(rows, tx);
      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');
      return entry;
    });
  }

  /** 내 출품작과 내가 던진 표. 화면이 출품·투표 버튼을 감추는 근거다. */
  async getMyState(userId: string): Promise<{ entry: LogoContestEntryWithVotes | null; votedEntryId: string | null }> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.userId, userId), isNull(logoContestEntries.deletedAt)));

      const [entry] = await this.attachMedia(rows, tx);

      const [vote] = await tx
        .select({ entryId: logoContestVotes.entryId })
        .from(logoContestVotes)
        .where(eq(logoContestVotes.userId, userId));

      return { entry: entry ?? null, votedEntryId: vote?.entryId ?? null };
    });
  }

  async create(userId: string, dto: CreateLogoContestEntryDto): Promise<LogoContestEntryWithVotes> {
    this.period.assertOpen();

    const mediaFileIds = this.normalizeMediaFileIds(dto.mediaFileIds);
    await this.fileOwner.assertOwnedImages(mediaFileIds, userId);

    const entryId = await this.createEntry(userId, dto, mediaFileIds);

    return this.getVisible(entryId);
  }

  private async createEntry(userId: string, dto: CreateLogoContestEntryDto, mediaFileIds: string[]): Promise<string> {
    try {
      return await this.insertEntry(userId, dto, mediaFileIds);
    } catch (error) {
      // 앱 레벨 선점 확인은 동시 요청 둘을 통과시킨다 — 실제로 막는 건 부분 unique 인덱스다.
      if (isDuplicateEntry(error)) {
        throw new AlreadySubmittedError();
      }
      throw error;
    }
  }

  private async insertEntry(userId: string, dto: CreateLogoContestEntryDto, mediaFileIds: string[]): Promise<string> {
    return this.db.run(async (tx) => {
      const existing = await tx
        .select({ id: logoContestEntries.id })
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.userId, userId), isNull(logoContestEntries.deletedAt)));

      if (existing.length > 0) {
        throw new AlreadySubmittedError();
      }

      const [entry] = await tx
        .insert(logoContestEntries)
        .values({
          userId,
          authorName: dto.authorName,
          title: dto.title,
          description: dto.description ?? null,
          agreedAt: new Date(),
        })
        .returning({ id: logoContestEntries.id });

      await tx
        .insert(logoContestEntryMedia)
        .values(mediaFileIds.map((fileId, index) => ({ entryId: entry.id, fileId, order: index })));

      return entry.id;
    });
  }

  /**
   * 출품 취소. 수정이 없으니 삭제 후 재출품이 유일한 정정 수단이다 —
   * 그래서 표도 같이 지워 투표자가 다시 투표할 수 있게 한다.
   *
   * 기간 밖에서는 막는다. 마감 뒤에 지울 수 있으면 득표를 지워 결과를 바꿀 수 있다.
   */
  async remove(userId: string, id: string): Promise<void> {
    this.period.assertOpen();

    await this.db.run(async (tx) => {
      const [entry] = await tx
        .select()
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.id, id), isNull(logoContestEntries.deletedAt)));

      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');
      if (entry.userId !== userId) throw new ForbiddenError('본인 출품작만 삭제할 수 있습니다.');

      await tx.delete(logoContestVotes).where(eq(logoContestVotes.entryId, id));
      await tx
        .update(logoContestEntries)
        .set({ deletedAt: new Date(), isWinner: false, updatedAt: new Date() })
        .where(eq(logoContestEntries.id, id));
    });
  }

  /** 한 계정의 표는 하나다. 다른 작품에 투표하면 기존 표를 옮긴다. */
  async vote(userId: string, entryId: string): Promise<{ voteCount: number }> {
    this.period.assertOpen();

    return this.db.run(async (tx) => {
      const [entry] = await tx
        .select()
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.id, entryId), this.visibleCondition()))
        .for('update');

      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');
      if (entry.userId === userId) throw new BadRequestError('자기 작품에는 투표할 수 없습니다.');

      await tx
        .insert(logoContestVotes)
        .values({ userId, entryId })
        .onConflictDoUpdate({ target: logoContestVotes.userId, set: { entryId } });

      const [{ value }] = await tx
        .select({ value: count() })
        .from(logoContestVotes)
        .where(eq(logoContestVotes.entryId, entryId));

      return { voteCount: value };
    });
  }

  async unvote(userId: string, entryId: string): Promise<{ voteCount: number }> {
    this.period.assertOpen();

    return this.db.run(async (tx) => {
      await tx
        .delete(logoContestVotes)
        .where(and(eq(logoContestVotes.userId, userId), eq(logoContestVotes.entryId, entryId)));

      const [{ value }] = await tx
        .select({ value: count() })
        .from(logoContestVotes)
        .where(eq(logoContestVotes.entryId, entryId));

      return { voteCount: value };
    });
  }

  // ─── 어드민 ───

  async listForAdmin(
    query: AdminLogoContestEntryListQueryDto,
  ): Promise<PaginatedResponseDto<LogoContestEntryWithVotes>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const conditions = [isNull(logoContestEntries.deletedAt)];
    if (query.status) conditions.push(eq(logoContestEntries.status, query.status));
    const search = query.q?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        or(
          ilike(logoContestEntries.title, pattern),
          ilike(logoContestEntries.description, pattern),
          ilike(logoContestEntries.authorName, pattern),
        )!,
      );
    }

    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(and(...conditions))
        .orderBy(
          ...(query.sort === 'latest'
            ? [desc(logoContestEntries.createdAt), desc(logoContestEntries.id)]
            : [desc(voteCountSql), asc(logoContestEntries.createdAt), asc(logoContestEntries.id)]),
        )
        .limit(limit)
        .offset((page - 1) * limit);

      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(logoContestEntries)
        .where(and(...conditions));

      return { data: await this.attachMedia(rows, tx), total, page, limit };
    });
  }

  /**
   * 숨기면 그 작품의 표를 지운다 — 투표자가 다른 작품에 다시 투표할 수 있게 하기 위해서다.
   * 숨김을 풀어도 표는 돌아오지 않는다.
   */
  async updateStatus(id: string, status: LogoContestEntryStatus): Promise<LogoContestEntryWithVotes> {
    const entryId = await this.db.run(async (tx) => {
      const [entry] = await tx
        .update(logoContestEntries)
        .set({ status, ...(status === 'hidden' ? { isWinner: false } : {}), updatedAt: new Date() })
        .where(and(eq(logoContestEntries.id, id), isNull(logoContestEntries.deletedAt)))
        .returning({ id: logoContestEntries.id });

      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');

      if (status === 'hidden') {
        await tx.delete(logoContestVotes).where(eq(logoContestVotes.entryId, id));
      }

      return entry.id;
    });

    return this.getForAdmin(entryId);
  }

  /** 대상은 한 명이다. 다른 작품을 지정하면 기존 대상이 해제되고 옮겨간다. */
  async designateWinner(id: string): Promise<LogoContestEntryWithVotes> {
    if (!this.period.isClosed()) {
      throw new BadRequestError('공모전 마감 후에 대상을 지정할 수 있습니다.');
    }

    const entryId = await this.db.run(async (tx) => {
      const [entry] = await tx
        .select()
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.id, id), this.visibleCondition()))
        .for('update');

      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');

      await tx
        .update(logoContestEntries)
        .set({ isWinner: false, updatedAt: new Date() })
        .where(eq(logoContestEntries.isWinner, true));

      await tx
        .update(logoContestEntries)
        .set({ isWinner: true, updatedAt: new Date() })
        .where(eq(logoContestEntries.id, id));

      return entry.id;
    });

    return this.getForAdmin(entryId);
  }

  private async getForAdmin(id: string): Promise<LogoContestEntryWithVotes> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ entry: logoContestEntries, voteCount: voteCountSql })
        .from(logoContestEntries)
        .where(and(eq(logoContestEntries.id, id), isNull(logoContestEntries.deletedAt)));

      const [entry] = await this.attachMedia(rows, tx);
      if (!entry) throw new NotFoundError('출품작을 찾을 수 없습니다.');
      return entry;
    });
  }

  private visibleCondition() {
    return and(eq(logoContestEntries.status, 'active'), isNull(logoContestEntries.deletedAt));
  }

  private normalizeMediaFileIds(mediaFileIds: string[]): string[] {
    if (mediaFileIds.length < MIN_LOGO_CONTEST_MEDIA_COUNT || mediaFileIds.length > MAX_LOGO_CONTEST_MEDIA_COUNT) {
      throw new BadRequestError(
        `이미지는 ${MIN_LOGO_CONTEST_MEDIA_COUNT}장 첨부해야 합니다.`,
      );
    }

    const unique = new Set(mediaFileIds);
    if (unique.size !== mediaFileIds.length) {
      throw new BadRequestError('같은 이미지를 두 번 첨부할 수 없습니다.');
    }
    return mediaFileIds;
  }

  private async attachMedia(
    rows: { entry: typeof logoContestEntries.$inferSelect; voteCount: number }[],
    tx: UgcTx,
  ): Promise<LogoContestEntryWithVotes[]> {
    if (rows.length === 0) return [];

    const media = await tx
      .select({ entryId: logoContestEntryMedia.entryId, fileId: logoContestEntryMedia.fileId })
      .from(logoContestEntryMedia)
      .where(
        inArray(
          logoContestEntryMedia.entryId,
          rows.map((row) => row.entry.id),
        ),
      )
      .orderBy(asc(logoContestEntryMedia.entryId), asc(logoContestEntryMedia.order));

    const byEntry = new Map<string, string[]>();
    media.forEach(({ entryId, fileId }) => {
      const list = byEntry.get(entryId) ?? [];
      list.push(fileId);
      byEntry.set(entryId, list);
    });

    return rows.map((row) => ({
      ...row.entry,
      voteCount: row.voteCount,
      mediaFileIds: byEntry.get(row.entry.id) ?? [],
    }));
  }
}
