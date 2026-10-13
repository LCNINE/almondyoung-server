import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { almondSavedDesigns, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { ALMOND_SAVED_DESIGN_MAX_PER_USER } from '../constants/almond-template.constants';
import { type AlmondSavedDesignEntity } from '../types/almond-saved-design.types';
import { containsDataUri } from './almond-design.manager';
import { parseAlmondTemplate } from './almond-template.manager';

export function parseAlmondSavedDesign(design: Record<string, unknown>, thumbnailSvg: string) {
  const { productId, widthMm, heightMm, title, design: normalized } = parseAlmondTemplate(design, thumbnailSvg);
  if (containsDataUri(design)) {
    throw new BadRequestError('시안 JSON 에 이미지를 직접 넣을 수 없습니다. 업로드한 파일(file:<id>)로 참조하세요.');
  }
  return { productId, widthMm, heightMm, title, design: normalized, thumbnailSvg };
}

@Injectable()
export class AlmondSavedDesignManager {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async upsert(
    userId: string,
    design: Record<string, unknown>,
    thumbnailSvg: string,
    id?: string,
    tx?: UgcTx,
  ): Promise<AlmondSavedDesignEntity> {
    const record = parseAlmondSavedDesign(design, thumbnailSvg);
    return this.db.run(async (trx) => {
      if (id) {
        const [updated] = await trx
          .update(almondSavedDesigns)
          .set({ ...record, updatedAt: new Date() })
          .where(and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId)))
          .returning();
        if (!updated) throw new NotFoundError(`Almond saved design not found: ${id}`);
        return updated;
      }
      await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`almond-saved-design:${userId}`}, 0))`);
      const [{ total }] = await trx
        .select({ total: count() })
        .from(almondSavedDesigns)
        .where(eq(almondSavedDesigns.userId, userId));
      if (total >= ALMOND_SAVED_DESIGN_MAX_PER_USER) {
        throw new ConflictError(
          `디자인은 ${ALMOND_SAVED_DESIGN_MAX_PER_USER}개까지 보관할 수 있습니다. 안 쓰는 디자인을 지운 뒤 저장해 주세요.`,
        );
      }
      const [created] = await trx
        .insert(almondSavedDesigns)
        .values({ ...record, userId })
        .returning();
      return created;
    }, tx);
  }

  async remove(userId: string, id: string, tx?: UgcTx): Promise<void> {
    await this.db.run(async (trx) => {
      const deleted = await trx
        .delete(almondSavedDesigns)
        .where(and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId)))
        .returning({ id: almondSavedDesigns.id });
      if (deleted.length === 0) throw new NotFoundError(`Almond saved design not found: ${id}`);
    }, tx);
  }

  async removeAllOf(userId: string, tx?: UgcTx): Promise<number> {
    return this.db.run(async (trx) => {
      const deleted = await trx
        .delete(almondSavedDesigns)
        .where(eq(almondSavedDesigns.userId, userId))
        .returning({ id: almondSavedDesigns.id });
      return deleted.length;
    }, tx);
  }
}
