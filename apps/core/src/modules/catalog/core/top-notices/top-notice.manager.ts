import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction, NewTopNotice } from '../../catalog.types';
import { TopNoticeEntity } from '../../schema/catalog.schema.types';
import { CreateTopNoticeDto, UpdateTopNoticeDto } from './dto';
import { TopNoticeReader } from './top-notice.reader';

type ResolvedTopNotice = {
  linkUrl: string | null;
  displayStartAt: Date | null;
  displayEndAt: Date | null;
};

@Injectable()
export class TopNoticeManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: TopNoticeReader,
  ) {}

  async create(dto: CreateTopNoticeDto, actorId?: string, tx?: DbTransaction): Promise<TopNoticeEntity> {
    return this.db.run(async (trx) => {
      const resolved: ResolvedTopNotice = {
        linkUrl: emptyToNull(dto.linkUrl),
        displayStartAt: toDate(dto.displayStartAt),
        displayEndAt: toDate(dto.displayEndAt),
      };

      assertValid(resolved);

      const values: NewTopNotice = {
        text: dto.text,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: actorId,
        updatedBy: actorId,
        ...resolved,
      };

      const [created] = await trx.insert(pimSchema.topNotices).values(values).returning();

      if (!created) {
        throw new Error('Top notice insert returned no row');
      }

      return created;
    }, tx);
  }

  async update(id: string, dto: UpdateTopNoticeDto, actorId?: string, tx?: DbTransaction): Promise<TopNoticeEntity> {
    return this.db.run(async (trx) => {
      const existing = await this.reader.findById(id, trx);

      // 기간을 한쪽만 고쳐도 수정 후의 기간이 성립하는지 봐야 한다.
      const resolved: ResolvedTopNotice = {
        linkUrl: dto.linkUrl === undefined ? existing.linkUrl : emptyToNull(dto.linkUrl),
        displayStartAt: dto.displayStartAt === undefined ? existing.displayStartAt : toDate(dto.displayStartAt),
        displayEndAt: dto.displayEndAt === undefined ? existing.displayEndAt : toDate(dto.displayEndAt),
      };

      assertValid(resolved);

      const [updated] = await trx
        .update(pimSchema.topNotices)
        .set({
          ...resolved,
          ...(dto.text !== undefined ? { text: dto.text } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedBy: actorId,
          updatedAt: new Date(),
        })
        .where(and(eq(pimSchema.topNotices.id, id), isNull(pimSchema.topNotices.deletedAt)))
        .returning();

      if (!updated) {
        throw new NotFoundError(`Top notice not found: ${id}`);
      }

      return updated;
    }, tx);
  }

  async softDelete(id: string, actorId?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (trx) => {
      const now = new Date();

      const [deleted] = await trx
        .update(pimSchema.topNotices)
        .set({ deletedAt: now, deletedBy: actorId, isActive: false, updatedAt: now })
        .where(and(eq(pimSchema.topNotices.id, id), isNull(pimSchema.topNotices.deletedAt)))
        .returning({ id: pimSchema.topNotices.id });

      if (!deleted) {
        throw new NotFoundError(`Top notice not found: ${id}`);
      }
    }, tx);
  }
}

function assertValid(notice: ResolvedTopNotice): void {
  if (notice.displayStartAt && notice.displayEndAt && notice.displayEndAt <= notice.displayStartAt) {
    throw new BadRequestError('게시 종료 일시는 시작 일시보다 뒤여야 합니다.');
  }

  if (notice.linkUrl && !isSafeLink(notice.linkUrl)) {
    throw new BadRequestError('링크는 http(s) 주소이거나 "/" 로 시작하는 사이트 내 경로여야 합니다.');
  }
}

function toDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

/** javascript: 등 위험한 스킴과 프로토콜 상대 경로를 막는다. */
function isSafeLink(url: string): boolean {
  if (url.startsWith('/')) return !url.startsWith('//');

  return /^https?:\/\//i.test(url);
}
