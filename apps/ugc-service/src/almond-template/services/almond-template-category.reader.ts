import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { almondTemplateCategories, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import { type AlmondTemplateCategoryEntity } from '../types/almond-template-category.types';

const ORDER = [asc(almondTemplateCategories.sortOrder), asc(almondTemplateCategories.createdAt)];

@Injectable()
export class AlmondTemplateCategoryReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  listVisible(tx?: UgcTx): Promise<AlmondTemplateCategoryEntity[]> {
    return this.db.run(
      (trx) =>
        trx
          .select()
          .from(almondTemplateCategories)
          .where(and(isNull(almondTemplateCategories.deletedAt), eq(almondTemplateCategories.isVisible, true)))
          .orderBy(...ORDER),
      tx,
    );
  }

  listAll(tx?: UgcTx): Promise<AlmondTemplateCategoryEntity[]> {
    return this.db.run(
      (trx) =>
        trx
          .select()
          .from(almondTemplateCategories)
          .where(isNull(almondTemplateCategories.deletedAt))
          .orderBy(...ORDER),
      tx,
    );
  }
}
