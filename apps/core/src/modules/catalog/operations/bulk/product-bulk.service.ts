import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { type PimSchema, productMasterVersions, productAuditLog } from '../../schema/catalog.schema';
import { BulkUpdateDto, BulkDeleteDto, BulkRestoreDto } from './dto';
import { DbTransaction } from '../../catalog.types';
import { ProductVersionsService } from '../../core/products/services/product-versions.service';
import { ProductMastersService } from '../../core/products/services/product-masters.service';

@Injectable()
export class ProductBulkService {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly productVersionsService: ProductVersionsService,
    private readonly productMastersService: ProductMastersService,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.db.db;
  }

  async bulkUpdate(dto: BulkUpdateDto, userId: string, tx?: DbTransaction) {
    // 판매중단은 단순 status UPDATE가 아니라 ProductMasterActiveVersionChanged(unpublished)
    // 이벤트 발행이 필요하다 — Medusa(스토어프론트)·검색 색인이 이 이벤트로 동기화된다.
    if (dto.status === 'inactive') {
      return this.bulkUnpublish(dto, userId, tx);
    }

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

  private async bulkUnpublish(dto: BulkUpdateDto, userId: string, tx?: DbTransaction) {
    const extraData: any = {
      updatedBy: userId,
    };
    if (dto.approvalStatus) extraData.approvalStatus = dto.approvalStatus;
    if (dto.brand) extraData.brand = dto.brand;
    if (dto.seller) extraData.seller = dto.seller;

    const products: (typeof productMasterVersions.$inferSelect)[] = [];

    for (const masterId of dto.productIds) {
      const run = async (trx: DbTransaction) => {
        const activeVersion = await this.productVersionsService.getActiveVersion(masterId, trx);

        // status 전환 + 이벤트 발행 + 가용재고 재계산
        await this.productVersionsService.unpublishMaster(masterId, trx);

        await trx.update(productMasterVersions).set(extraData).where(eq(productMasterVersions.id, activeVersion.id));

        const changes = { status: 'inactive', ...extraData, updatedAt: new Date() };
        await trx.insert(productAuditLog).values({
          versionId: activeVersion.id,
          action: 'bulk_updated',
          changes,
          userId,
          timestamp: new Date(),
        });

        products.push({ ...activeVersion, ...extraData, status: 'inactive' });
      };

      try {
        if (tx) {
          await run(tx);
        } else {
          await this.db.db.transaction(run);
        }
      } catch (error) {
        // active 버전이 없는 master는 skip — 기존 직접 UPDATE의 status='active' 조건과 같은 의미
        if (error instanceof NotFoundException) continue;
        throw error;
      }
    }

    return {
      updated: products.length,
      products,
    };
  }

  async bulkSoftDelete(dto: BulkDeleteDto, userId: string, tx?: DbTransaction) {
    // 단건 삭제 경로(deleteVersion)로 위임 — ProductMasterDeleted 이벤트 발행과
    // 가용재고 재계산이 함께 이뤄져 Medusa·검색 색인이 동기화된다.
    const products: (typeof productMasterVersions.$inferSelect)[] = [];

    for (const masterId of dto.productIds) {
      const run = async (trx: DbTransaction) => {
        const activeVersion = await this.productVersionsService.getActiveVersion(masterId, trx);
        const deleted = await this.productMastersService.deleteVersion(activeVersion.id, userId, trx);
        products.push(deleted);
      };

      try {
        if (tx) {
          await run(tx);
        } else {
          await this.db.db.transaction(run);
        }
      } catch (error) {
        // active 버전이 없거나 이미 삭제된 master는 skip — 기존 status='active' 필터와 같은 의미
        if (error instanceof NotFoundException || error instanceof BadRequestException) continue;
        throw error;
      }
    }

    return {
      deleted: products.length,
      products,
    };
  }

  async bulkRestore(dto: BulkRestoreDto, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const targets = await client
      .select({ id: productMasterVersions.id })
      .from(productMasterVersions)
      .where(
        and(
          inArray(productMasterVersions.masterId, dto.productIds),
          eq(productMasterVersions.status, 'active'),
          isNotNull(productMasterVersions.deletedAt),
        ),
      );

    // 단건 복원 경로(restore)로 위임 — audit + 가용재고 재계산 포함.
    // 주의: restore는 republish 이벤트를 발행하지 않으므로 Medusa 노출 복구는 별도 publish가 필요하다.
    const products: (typeof productMasterVersions.$inferSelect)[] = [];

    for (const target of targets) {
      const run = async (trx: DbTransaction) => {
        const restored = await this.productMastersService.restore(target.id, userId, trx);
        products.push(restored);
      };

      try {
        if (tx) {
          await run(tx);
        } else {
          await this.db.db.transaction(run);
        }
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof BadRequestException) continue;
        throw error;
      }
    }

    return {
      restored: products.length,
      products,
    };
  }
}
