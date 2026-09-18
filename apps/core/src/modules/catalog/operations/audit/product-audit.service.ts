import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productAuditLog, productImages, productMasterVersions } from '../../schema/catalog.schema';

const auditLogItem = {
  id: productAuditLog.id,
  productId: productAuditLog.masterId,
  versionId: productAuditLog.versionId,
  action: productAuditLog.action,
  userId: productAuditLog.userId,
  createdAt: productAuditLog.timestamp,
};

@Injectable()
export class ProductAuditService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getProductAuditHistory(masterId: string) {
    const rows = await this.db
      .select({ ...auditLogItem, changes: productAuditLog.changes })
      .from(productAuditLog)
      .where(eq(productAuditLog.masterId, masterId))
      .orderBy(desc(productAuditLog.timestamp), desc(productAuditLog.id));
    return this.withProducts(rows);
  }

  async listAuditLogs(query: { action?: string; userId?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where = and(
      query.action ? eq(productAuditLog.action, query.action) : undefined,
      query.userId ? eq(productAuditLog.userId, query.userId) : undefined,
    );

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(auditLogItem)
        .from(productAuditLog)
        .where(where)
        .orderBy(desc(productAuditLog.timestamp), desc(productAuditLog.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ total: count() }).from(productAuditLog).where(where),
    ]);

    return { data: await this.withProducts(rows), total, page, limit };
  }

  private async withProducts<T extends { productId: string | null }>(rows: T[]) {
    const masterIds = [...new Set(rows.map((r) => r.productId).filter((id): id is string => !!id))];
    if (masterIds.length === 0) {
      return rows.map((row) => ({ ...row, productName: null, productThumbnail: null }));
    }

    const versions = await this.db
      .selectDistinctOn([productMasterVersions.masterId], {
        masterId: productMasterVersions.masterId,
        versionId: productMasterVersions.id,
        name: productMasterVersions.name,
      })
      .from(productMasterVersions)
      .where(inArray(productMasterVersions.masterId, masterIds))
      .orderBy(
        productMasterVersions.masterId,
        sql`(${productMasterVersions.status} = 'active') desc`,
        desc(productMasterVersions.createdAt),
      );

    const thumbnails =
      versions.length === 0
        ? []
        : await this.db
            .select({ versionId: productImages.versionId, fileId: productImages.fileId })
            .from(productImages)
            .where(
              and(
                inArray(
                  productImages.versionId,
                  versions.map((v) => v.versionId),
                ),
                eq(productImages.isPrimary, true),
              ),
            );

    const thumbnailByVersion = new Map(thumbnails.map((t) => [t.versionId, t.fileId]));
    const productByMaster = new Map(
      versions.map((v) => [v.masterId, { name: v.name, thumbnail: thumbnailByVersion.get(v.versionId) ?? null }]),
    );

    return rows.map((row) => {
      const product = row.productId ? productByMaster.get(row.productId) : undefined;
      return { ...row, productName: product?.name ?? null, productThumbnail: product?.thumbnail ?? null };
    });
  }
}
