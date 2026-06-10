import { Injectable } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, inArray } from 'drizzle-orm';
import { type PimSchema, productMasterVersions, productAuditLog } from '../../schema/catalog.schema';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto } from './dto';
import { DbTransaction } from '../../catalog.types';

@Injectable()
export class ProductBulkService {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async bulkUpdate(dto: BulkUpdateDto, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const updateData: any = {
      updatedAt: new Date(),
      updatedBy: userId,
    };

    if (dto.status) updateData.status = dto.status;
    if (dto.approvalStatus) updateData.approvalStatus = dto.approvalStatus;
    if (dto.brand) updateData.brand = dto.brand;
    if (dto.seller) updateData.seller = dto.seller;

    const updated = await client
      .update(productMasterVersions)
      .set(updateData)
      .where(and(inArray(productMasterVersions.masterId, dto.productIds), eq(productMasterVersions.status, 'active')))
      .returning();

    // Log bulk update
    for (const product of updated) {
      await client.insert(productAuditLog).values({
        versionId: product.id,
        action: 'bulk_updated',
        changes: updateData,
        userId,
        timestamp: new Date(),
      });
    }

    return {
      updated: updated.length,
      products: updated,
    };
  }

  async bulkSoftDelete(dto: BulkDeleteDto, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const deleted = await client
      .update(productMasterVersions)
      .set({
        deletedAt: new Date(),
        deletedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(inArray(productMasterVersions.masterId, dto.productIds), eq(productMasterVersions.status, 'active')))
      .returning();

    // Log bulk delete
    for (const product of deleted) {
      await client.insert(productAuditLog).values({
        versionId: product.id,
        action: 'bulk_deleted',
        changes: { deletedAt: product.deletedAt },
        userId,
        timestamp: new Date(),
      });
    }

    return {
      deleted: deleted.length,
      products: deleted,
    };
  }

  async bulkRestore(dto: BulkRestoreDto, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const restored = await client
      .update(productMasterVersions)
      .set({
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
      })
      .where(and(inArray(productMasterVersions.masterId, dto.productIds), eq(productMasterVersions.status, 'active')))
      .returning();

    // Log bulk restore
    for (const product of restored) {
      await client.insert(productAuditLog).values({
        versionId: product.id,
        action: 'bulk_restored',
        changes: { deletedAt: null },
        userId,
        timestamp: new Date(),
      });
    }

    return {
      restored: restored.length,
      products: restored,
    };
  }
}
