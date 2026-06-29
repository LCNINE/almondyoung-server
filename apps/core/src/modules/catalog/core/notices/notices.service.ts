import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, gt, ilike, isNull, lte, or, SQL } from 'drizzle-orm';
import { type PimSchema, pimSchema } from '../../schema/catalog.schema';
import { DbTransaction, NewNotice } from '../../catalog.types';
import { CreateNoticeDto, NoticeResponseDto, UpdateNoticeDto } from './dto';
import { NoticeMapper } from './mappers';

@Injectable()
export class NoticesService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  async createNotice(dto: CreateNoticeDto, tx?: DbTransaction): Promise<NoticeResponseDto> {
    return this.db.run(async (tx) => {
      const newNotice: NewNotice = {
        ...dto,
        displayStartAt: dto.displayStartAt ? new Date(dto.displayStartAt) : null,
        displayEndAt: dto.displayEndAt ? new Date(dto.displayEndAt) : null,
      };

      const [createdNotice] = await tx.insert(pimSchema.notices).values(newNotice).returning();

      return NoticeMapper.toDto(createdNotice);
    }, tx);
  }

  async getNoticeById(id: string, tx?: DbTransaction): Promise<NoticeResponseDto> {
    return this.db.run(async (tx) => {
      const [notice] = await tx
        .select()
        .from(pimSchema.notices)
        .where(and(eq(pimSchema.notices.id, id), isNull(pimSchema.notices.deletedAt)))
        .limit(1);

      if (!notice) {
        throw new NotFoundError(`Notice not found: ${id}`);
      }

      return NoticeMapper.toDto(notice);
    }, tx);
  }

  async listNotices(
    options: {
      category?: string;
      includeInactive?: boolean;
      isActive?: boolean;
      isPinned?: boolean;
      badge?: string;
      q?: string;
    } = {},
    tx?: DbTransaction,
  ): Promise<NoticeResponseDto[]> {
    return this.db.run(async (tx) => {
      const conditions: SQL[] = [isNull(pimSchema.notices.deletedAt)];

      if (options.category) {
        conditions.push(eq(pimSchema.notices.category, options.category));
      }

      if (options.isActive !== undefined) {
        conditions.push(eq(pimSchema.notices.isActive, options.isActive));
      } else if (!options.includeInactive) {
        conditions.push(eq(pimSchema.notices.isActive, true));
      }

      if (options.isPinned !== undefined) {
        conditions.push(eq(pimSchema.notices.isPinned, options.isPinned));
      }

      if (options.badge) {
        conditions.push(eq(pimSchema.notices.badge, options.badge));
      }

      if (options.q?.trim()) {
        conditions.push(ilike(pimSchema.notices.title, `%${options.q.trim()}%`));
      }

      const notices = await tx
        .select()
        .from(pimSchema.notices)
        .where(and(...conditions))
        .orderBy(desc(pimSchema.notices.isPinned), pimSchema.notices.sortOrder, desc(pimSchema.notices.createdAt));

      return NoticeMapper.toDtoArray(notices);
    }, tx);
  }

  /**
   * 스토어프론트용: 활성 + 게시기간 내인 공지만
   */
  async listPublicNotices(category?: string, tx?: DbTransaction): Promise<NoticeResponseDto[]> {
    return this.db.run(async (tx) => {
      const now = new Date();

      const conditions: SQL[] = [
        isNull(pimSchema.notices.deletedAt),
        eq(pimSchema.notices.isActive, true),
        or(isNull(pimSchema.notices.displayStartAt), lte(pimSchema.notices.displayStartAt, now))!,
        or(isNull(pimSchema.notices.displayEndAt), gt(pimSchema.notices.displayEndAt, now))!,
      ];

      if (category) {
        conditions.push(eq(pimSchema.notices.category, category));
      }

      const notices = await tx
        .select()
        .from(pimSchema.notices)
        .where(and(...conditions))
        .orderBy(desc(pimSchema.notices.isPinned), pimSchema.notices.sortOrder, desc(pimSchema.notices.createdAt));

      return NoticeMapper.toDtoArray(notices);
    }, tx);
  }

  async updateNotice(id: string, dto: UpdateNoticeDto, tx?: DbTransaction): Promise<NoticeResponseDto> {
    return this.db.run(async (tx) => {
      const updateData = {
        ...dto,
        displayStartAt: dto.displayStartAt ? new Date(dto.displayStartAt) : undefined,
        displayEndAt: dto.displayEndAt ? new Date(dto.displayEndAt) : undefined,
        updatedAt: new Date(),
      };

      const [updatedNotice] = await tx
        .update(pimSchema.notices)
        .set(updateData)
        .where(and(eq(pimSchema.notices.id, id), isNull(pimSchema.notices.deletedAt)))
        .returning();

      if (!updatedNotice) {
        throw new NotFoundError(`Notice not found: ${id}`);
      }

      return NoticeMapper.toDto(updatedNotice);
    }, tx);
  }

  async deleteNotice(id: string, deletedBy?: string, tx?: DbTransaction): Promise<void> {
    return this.db.run(async (tx) => {
      const now = new Date();

      const [deletedNotice] = await tx
        .update(pimSchema.notices)
        .set({ deletedAt: now, deletedBy, updatedAt: now })
        .where(and(eq(pimSchema.notices.id, id), isNull(pimSchema.notices.deletedAt)))
        .returning();

      if (!deletedNotice) {
        throw new NotFoundError(`Notice not found: ${id}`);
      }
    }, tx);
  }
}
