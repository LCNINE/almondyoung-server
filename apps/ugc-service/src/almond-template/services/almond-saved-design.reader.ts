import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { almondSavedDesigns, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { type AlmondSavedDesignEntity, type AlmondSavedDesignSummary } from '../types/almond-saved-design.types';

const summaryColumns = {
  id: almondSavedDesigns.id,
  userId: almondSavedDesigns.userId,
  productId: almondSavedDesigns.productId,
  widthMm: almondSavedDesigns.widthMm,
  heightMm: almondSavedDesigns.heightMm,
  title: almondSavedDesigns.title,
  createdAt: almondSavedDesigns.createdAt,
  updatedAt: almondSavedDesigns.updatedAt,
};

export interface AlmondSavedDesignFilter {
  productId?: string;
  widthMm?: number;
  heightMm?: number;
}

@Injectable()
export class AlmondSavedDesignReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async listOwned(userId: string, filter: AlmondSavedDesignFilter, tx?: UgcTx): Promise<AlmondSavedDesignSummary[]> {
    const conditions: SQL[] = [eq(almondSavedDesigns.userId, userId)];
    if (filter.productId) conditions.push(eq(almondSavedDesigns.productId, filter.productId.toLowerCase()));
    if (filter.widthMm !== undefined) conditions.push(eq(almondSavedDesigns.widthMm, filter.widthMm));
    if (filter.heightMm !== undefined) conditions.push(eq(almondSavedDesigns.heightMm, filter.heightMm));
    return this.db.run(
      (trx) =>
        trx
          .select(summaryColumns)
          .from(almondSavedDesigns)
          .where(and(...conditions))
          .orderBy(desc(almondSavedDesigns.updatedAt), desc(almondSavedDesigns.id)),
      tx,
    );
  }

  async findOwned(userId: string, id: string, tx?: UgcTx): Promise<AlmondSavedDesignEntity> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(almondSavedDesigns)
        .where(and(eq(almondSavedDesigns.id, id), eq(almondSavedDesigns.userId, userId)))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond saved design not found: ${id}`);
      return row;
    }, tx);
  }
}
