import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, asc, eq, gt, ilike, isNull, lte, or, SQL } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction } from '../../catalog.types';
import { TopNoticeEntity } from '../../schema/catalog.schema.types';
import { TopNoticeListQueryDto } from './dto';

@Injectable()
export class TopNoticeReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async findById(id: string, tx?: DbTransaction): Promise<TopNoticeEntity> {
    return this.db.run(async (trx) => {
      const [notice] = await trx
        .select()
        .from(pimSchema.topNotices)
        .where(and(eq(pimSchema.topNotices.id, id), isNull(pimSchema.topNotices.deletedAt)))
        .limit(1);

      if (!notice) {
        throw new NotFoundError(`Top notice not found: ${id}`);
      }

      return notice;
    }, tx);
  }

  /** 관리자 목록. 기본은 비활성 제외, includeInactive 로 전체 조회 */
  async findAll(query: TopNoticeListQueryDto = {}, tx?: DbTransaction): Promise<TopNoticeEntity[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [isNull(pimSchema.topNotices.deletedAt)];

      if (query.isActive !== undefined) {
        conditions.push(eq(pimSchema.topNotices.isActive, query.isActive));
      } else if (!query.includeInactive) {
        conditions.push(eq(pimSchema.topNotices.isActive, true));
      }

      if (query.q?.trim()) {
        conditions.push(ilike(pimSchema.topNotices.text, `%${query.q.trim()}%`));
      }

      return trx
        .select()
        .from(pimSchema.topNotices)
        .where(and(...conditions))
        .orderBy(asc(pimSchema.topNotices.sortOrder), asc(pimSchema.topNotices.createdAt));
    }, tx);
  }

  /** 스토어프론트용. 활성 + 게시기간 내 */
  async findPublic(now: Date = new Date(), tx?: DbTransaction): Promise<TopNoticeEntity[]> {
    return this.db.run(async (trx) => {
      const conditions: SQL[] = [
        isNull(pimSchema.topNotices.deletedAt),
        eq(pimSchema.topNotices.isActive, true),
        or(isNull(pimSchema.topNotices.displayStartAt), lte(pimSchema.topNotices.displayStartAt, now))!,
        or(isNull(pimSchema.topNotices.displayEndAt), gt(pimSchema.topNotices.displayEndAt, now))!,
      ];

      return trx
        .select()
        .from(pimSchema.topNotices)
        .where(and(...conditions))
        .orderBy(asc(pimSchema.topNotices.sortOrder), asc(pimSchema.topNotices.createdAt));
    }, tx);
  }
}
