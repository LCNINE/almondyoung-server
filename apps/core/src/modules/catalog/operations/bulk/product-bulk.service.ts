import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
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

    // 활성화는 publish 경로(가격·variant 검증 + 이벤트 발행)를 타야 하며 부분 실패를 허용한다.
    if (dto.status === 'active') {
      return this.bulkActivate(dto, userId, tx);
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

  /**
   * 판매중단(inactive) 상품 일괄 재공개.
   * master별 최신 inactive 버전을 publishVersion으로 publish — 검증 실패(가격 미설정 등)는
   * 해당 master만 failed에 수집하고 나머지는 계속 진행한다.
   */
  private async bulkActivate(dto: BulkUpdateDto, userId: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    const products: (typeof productMasterVersions.$inferSelect)[] = [];
    const failed: { masterId: string; name: string | null; reason: string }[] = [];

    for (const masterId of dto.productIds) {
      // 이미 판매중인 master는 skip
      const [active] = await client
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'active'),
            isNull(productMasterVersions.deletedAt),
          ),
        )
        .limit(1);
      if (active) continue;

      // 최신 inactive 버전을 publish 대상으로 선택
      const [target] = await client
        .select()
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'inactive'),
            isNull(productMasterVersions.deletedAt),
          ),
        )
        .orderBy(desc(productMasterVersions.createdAt))
        .limit(1);

      if (!target) {
        failed.push({ masterId, name: null, reason: '판매중단 상태의 버전이 없습니다' });
        continue;
      }

      const run = async (trx: DbTransaction) => {
        await this.productVersionsService.publishVersion(target.id, trx);
        await trx.insert(productAuditLog).values({
          versionId: target.id,
          action: 'bulk_activated',
          changes: { status: 'active' },
          userId,
          timestamp: new Date(),
        });
      };

      try {
        // publishVersion은 검증 전에 쓰기를 시작하므로, 실패한 master의 부분 쓰기가
        // 남지 않도록 외부 tx가 있어도 savepoint(중첩 트랜잭션)로 감싼다.
        if (tx) {
          await tx.transaction(run);
        } else {
          await this.db.db.transaction(run);
        }
        products.push({ ...target, status: 'active' });
      } catch (error) {
        failed.push({ masterId, name: target.name, reason: error?.message ?? '알 수 없는 오류' });
      }
    }

    return {
      updated: products.length,
      products,
      failed,
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
