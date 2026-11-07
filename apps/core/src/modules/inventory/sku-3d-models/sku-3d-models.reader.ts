import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, count, desc, eq, ilike, ne, or, type SQL } from 'drizzle-orm';
import { sku3dModels, skus, wmsSchema } from '../schema/inventory.schema';
import { likeContains } from '../sku-field-capture/sku-field-capture.rules';

export type Sku3dModelVisibility = 'public' | 'private';

export type Sku3dModelUploadFilter = {
  q?: string;
  uploader?: string;
  visibility?: Sku3dModelVisibility;
  page: number;
  limit: number;
};

@Injectable()
export class Sku3dModelsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>) {}

  async listUploads({ q, uploader, visibility, page, limit }: Sku3dModelUploadFilter) {
    const conditions: SQL[] = [];

    if (q) {
      conditions.push(or(ilike(skus.name, likeContains(q)), ilike(skus.code, likeContains(q)))!);
    }

    if (uploader) {
      conditions.push(ilike(sku3dModels.uploadedByLabel, likeContains(uploader)));
    }

    if (visibility === 'public') {
      conditions.push(eq(sku3dModels.status, 'approved'));
    }

    if (visibility === 'private') {
      conditions.push(ne(sku3dModels.status, 'approved'));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [{ total }]] = await Promise.all([
      this.db.db
        .select({
          id: sku3dModels.id,
          skuId: sku3dModels.skuId,
          skuCode: skus.code,
          skuName: skus.name,
          version: sku3dModels.version,
          status: sku3dModels.status,
          glbFileId: sku3dModels.glbFileId,
          uploadedByLabel: sku3dModels.uploadedByLabel,
          createdAt: sku3dModels.createdAt,
        })
        .from(sku3dModels)
        .innerJoin(skus, eq(skus.id, sku3dModels.skuId))
        .where(where)
        .orderBy(desc(sku3dModels.createdAt), desc(sku3dModels.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.db
        .select({ total: count() })
        .from(sku3dModels)
        .innerJoin(skus, eq(skus.id, sku3dModels.skuId))
        .where(where),
    ]);

    return { items, total };
  }
}
