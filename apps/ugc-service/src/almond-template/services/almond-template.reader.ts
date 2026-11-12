import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { almondTemplates, type UgcServiceSchema, type UgcTx } from '../../db/schema';
import {
  type AdminAlmondTemplateSummary,
  type AlmondTemplateEntity,
  type AlmondTemplateSummary,
} from '../types/almond-template.types';

const summaryColumns = {
  id: almondTemplates.id,
  productId: almondTemplates.productId,
  widthMm: almondTemplates.widthMm,
  heightMm: almondTemplates.heightMm,
  title: almondTemplates.title,
  industry: almondTemplates.industry,
  purpose: almondTemplates.purpose,
  colors: almondTemplates.colors,
  status: almondTemplates.status,
  createdBy: almondTemplates.createdBy,
  updatedBy: almondTemplates.updatedBy,
  createdAt: almondTemplates.createdAt,
  updatedAt: almondTemplates.updatedAt,
  kind: sql<
    string | null
  >`case when jsonb_typeof(${almondTemplates.design}->'kind') = 'string' then ${almondTemplates.design}->>'kind' end`,
  // designPrintsBack 의 SQL 짝. 목록에서 design 전체를 읽지 않으려고 둘로 둔다
  printsBack: sql<boolean>`(
    (jsonb_typeof(${almondTemplates.design}->'back') = 'array' and jsonb_array_length(${almondTemplates.design}->'back') > 0)
    or jsonb_typeof(${almondTemplates.design}->'backBackground'->'backgroundImage') = 'string'
    or (jsonb_typeof(${almondTemplates.design}->'backBackground'->'background') = 'string'
      and lower(${almondTemplates.design}->'backBackground'->>'background') <> '#ffffff')
  )`,
};

const notDeleted = isNull(almondTemplates.deletedAt);

@Injectable()
export class AlmondTemplateReader {
  constructor(@InjectDb() private readonly db: DbService<UgcServiceSchema>) {}

  async listPublished(tx?: UgcTx): Promise<AlmondTemplateSummary[]> {
    return this.db.run(
      (trx) =>
        trx
          .select(summaryColumns)
          .from(almondTemplates)
          .where(and(eq(almondTemplates.status, 'published'), notDeleted))
          .orderBy(desc(almondTemplates.updatedAt), desc(almondTemplates.id)),
      tx,
    );
  }

  async listAll(tx?: UgcTx): Promise<AdminAlmondTemplateSummary[]> {
    return this.db.run(
      (trx) =>
        trx
          .select(summaryColumns)
          .from(almondTemplates)
          .where(notDeleted)
          .orderBy(desc(almondTemplates.updatedAt), desc(almondTemplates.id)),
      tx,
    );
  }

  async findPublished(id: string, tx?: UgcTx): Promise<AlmondTemplateEntity> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(almondTemplates)
        .where(and(eq(almondTemplates.id, id), eq(almondTemplates.status, 'published'), notDeleted))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond template not found: ${id}`);
      return row;
    }, tx);
  }

  async findPublishedThumbnail(id: string, tx?: UgcTx): Promise<string> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ thumbnailSvg: almondTemplates.thumbnailSvg })
        .from(almondTemplates)
        .where(and(eq(almondTemplates.id, id), eq(almondTemplates.status, 'published'), notDeleted))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond template not found: ${id}`);
      return row.thumbnailSvg;
    }, tx);
  }

  async findThumbnail(id: string, tx?: UgcTx): Promise<string> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ thumbnailSvg: almondTemplates.thumbnailSvg })
        .from(almondTemplates)
        .where(and(eq(almondTemplates.id, id), notDeleted))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond template not found: ${id}`);
      return row.thumbnailSvg;
    }, tx);
  }

  async findById(id: string, tx?: UgcTx): Promise<AlmondTemplateEntity> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(almondTemplates)
        .where(and(eq(almondTemplates.id, id), notDeleted))
        .limit(1);
      if (!row) throw new NotFoundError(`Almond template not found: ${id}`);
      return row;
    }, tx);
  }
}
