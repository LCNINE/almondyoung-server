import { Injectable } from '@nestjs/common';
import { BadRequestError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { almondTemplateCategories, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { PublicFileClient } from '../clients/public-file.client';
import {
  type AlmondTemplateCategoryEntity,
  type AlmondTemplateCategoryInput,
} from '../types/almond-template-category.types';

export function isSameCategorySet(ids: readonly string[], current: readonly string[]): boolean {
  const set = new Set(current);

  return new Set(ids).size === ids.length && ids.length === set.size && ids.every((id) => set.has(id));
}

const active = (id: string) => and(eq(almondTemplateCategories.id, id), isNull(almondTemplateCategories.deletedAt));

@Injectable()
export class AlmondTemplateCategoryManager {
  constructor(
    @InjectDb() private readonly db: DbService<UgcServiceSchema>,
    private readonly files: PublicFileClient,
  ) {}

  private async assertImage(fileId: string): Promise<void> {
    const mime = await this.files.fetchImageMime(fileId);
    if (!mime) throw new BadRequestError('카드 이미지는 JPG·PNG·WEBP 만 올릴 수 있습니다.');
  }

  // 추가·삭제·정렬을 한 줄로 세운다. 동시에 추가하면 같은 순번을 받거나, 정렬 검사가 막 추가된 것을 못 보기 때문이다
  private async lockList(trx: UgcTx): Promise<void> {
    await trx.execute(sql`select pg_advisory_xact_lock(hashtext('almond_template_categories'))`);
  }

  // 새 카테고리는 맨 뒤에 붙는다
  async create(input: AlmondTemplateCategoryInput, userId: string, tx?: UgcTx): Promise<AlmondTemplateCategoryEntity> {
    await this.assertImage(input.imageFileId);

    return this.db.run(async (trx) => {
      await this.lockList(trx);
      const [created] = await trx
        .insert(almondTemplateCategories)
        .values({
          ...input,
          createdBy: userId,
          sortOrder: sql`(select coalesce(max(${almondTemplateCategories.sortOrder}) + 1, 0) from ${almondTemplateCategories} where ${almondTemplateCategories.deletedAt} is null)`,
        })
        .returning();

      return created;
    }, tx);
  }

  async update(
    id: string,
    input: AlmondTemplateCategoryInput,
    userId: string,
    tx?: UgcTx,
  ): Promise<AlmondTemplateCategoryEntity> {
    await this.assertImage(input.imageFileId);

    return this.db.run(async (trx) => {
      const [updated] = await trx
        .update(almondTemplateCategories)
        .set({ ...input, updatedBy: userId, updatedAt: new Date() })
        .where(active(id))
        .returning();
      if (!updated) throw new NotFoundError(`Almond template category not found: ${id}`);

      return updated;
    }, tx);
  }

  async remove(id: string, userId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      await this.lockList(trx);
      const deleted = await trx
        .update(almondTemplateCategories)
        .set({ deletedAt: new Date(), deletedBy: userId })
        .where(active(id))
        .returning({ id: almondTemplateCategories.id });
      if (deleted.length === 0) throw new NotFoundError(`Almond template category not found: ${id}`);
    }, tx);
  }

  // 화면에 보이던 목록과 지금 목록이 다르면(그 사이 누가 추가·삭제) 순서를 덮어쓰지 않는다
  async reorder(ids: string[], userId: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      await this.lockList(trx);
      const rows = await trx
        .select({ id: almondTemplateCategories.id })
        .from(almondTemplateCategories)
        .where(isNull(almondTemplateCategories.deletedAt));
      const current = rows.map((row) => row.id);
      if (!isSameCategorySet(ids, current))
        throw new BadRequestError('카테고리 목록이 바뀌었습니다. 새로고침 후 다시 정렬해 주세요.');

      const now = new Date();
      for (const [index, id] of ids.entries()) {
        await trx
          .update(almondTemplateCategories)
          .set({ sortOrder: index, updatedBy: userId, updatedAt: now })
          .where(eq(almondTemplateCategories.id, id));
      }
    }, tx);
  }
}
