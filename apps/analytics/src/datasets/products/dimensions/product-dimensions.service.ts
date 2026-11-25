import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq, getTableName, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  ProductInventoryManagementChangedPayload,
  ProductMasterActiveVersionChangedPayload,
  ProductMasterDeletedPayload,
  ProductVariantCreatedPayload,
  ProductVariantDeletedPayload,
  ProductVariantUpdatedPayload,
} from '@packages/event-contracts/streams/product.stream';
import { analyticsSchema, dimProductCategories, dimProductMasters, dimProductVariants } from '../../../schema';
import { DbTx } from '../../../db.types';

/*
 * 이벤트 순서 역전 가드(#722).
 *
 * 같은 master/variant 의 이벤트가 늦게 도착할 수 있다 — core outbox 는 strictPartitionOrdering 이
 * 꺼져 있어 백오프 중인 행을 건너뛰고 뒤 행을 먼저 내보내고, DLQ 재처리는 옛 이벤트를 같은 키로 다시 넣는다.
 * 그래서 upsert 는 «행의 last_event_at 보다 오래된 이벤트»(stale)를 이렇게 다룬다:
 *
 * - keepIfStale — 지금 값을 지킨다. null 이 «모름»이 아니라 뜻을 갖는 칸(삭제 안 됨·미게시·원가 지움)이라,
 *   옛 이벤트가 덮으면 삭제된 상품이 되살아나거나 지운 원가가 돌아온다.
 * - fillIfStale — 비어 있을 때만 채운다. 이벤트마다 싣는 칸이 달라서(생성은 전부, 수정은 이름·상태만)
 *   옛 이벤트를 통째로 버리면 그 이벤트에만 있던 칸이 영영 빈다.
 *
 * 비교는 excluded.last_event_at(= 이 이벤트 시각)으로 한다. Date 를 sql 템플릿 파라미터로 넘기지 않는다.
 * 같은 시각이면 stale 이 아니다 — 같은 이벤트의 재전달은 종전처럼 덮어쓴다.
 */
const currentValue = (column: AnyPgColumn): SQL => sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
const incomingValue = (column: AnyPgColumn): SQL => sql.raw(`excluded."${column.name}"`);
const isStaleEvent = (lastEventAt: AnyPgColumn): SQL =>
  sql`(${currentValue(lastEventAt)} IS NOT NULL AND ${incomingValue(lastEventAt)} < ${currentValue(lastEventAt)})`;
const keepIfStale = (column: AnyPgColumn, lastEventAt: AnyPgColumn): SQL =>
  sql`CASE WHEN ${isStaleEvent(lastEventAt)} THEN ${currentValue(column)} ELSE ${incomingValue(column)} END`;
const fillIfStale = (column: AnyPgColumn, lastEventAt: AnyPgColumn): SQL =>
  sql`CASE WHEN ${isStaleEvent(lastEventAt)} THEN COALESCE(${currentValue(column)}, ${incomingValue(column)}) ELSE ${incomingValue(column)} END`;
const latestEventAt = (lastEventAt: AnyPgColumn): SQL =>
  sql`GREATEST(${currentValue(lastEventAt)}, ${incomingValue(lastEventAt)})`;

type MasterPatch = {
  masterId: string;
  name?: string | null;
  activeVersionId?: string | null;
  isActive?: boolean | null;
  lastChangeReason?: string | null;
  supplyPrice?: number | null;
  deletedAt?: Date | null;
  eventAt?: Date;
};

type VariantPatch = {
  variantId: string;
  masterId: string;
  versionId: string;
  variantName?: string | null;
  isDefault?: boolean | null;
  status?: string | null;
  inventoryManagement?: boolean | null;
  preStockSellable?: boolean | null;
  alwaysSellableZeroStock?: boolean | null;
  createdAt?: Date;
  deletedAt?: Date | null;
  eventAt?: Date;
};

@Injectable()
export class ProductDimensionsService {
  private readonly logger = new Logger(ProductDimensionsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async recordVariantCreated(payload: ProductVariantCreatedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.createdAt);
    await this.inTx(async (executor) => {
      await this.upsertMaster(
        {
          masterId: payload.masterId,
          name: payload.productName,
          eventAt,
        },
        executor,
      );

      await this.upsertVariant(
        {
          variantId: payload.variantId,
          masterId: payload.masterId,
          versionId: payload.versionId,
          variantName: payload.variantName,
          isDefault: payload.isDefault,
          status: payload.status,
          inventoryManagement: payload.inventoryManagement,
          preStockSellable: payload.preStockSellable ?? null,
          alwaysSellableZeroStock: payload.alwaysSellableZeroStock ?? null,
          createdAt: eventAt,
          eventAt,
        },
        executor,
      );
    }, tx);
  }

  async recordVariantUpdated(payload: ProductVariantUpdatedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.updatedAt);
    await this.inTx(async (executor) => {
      await this.upsertVariant(
        {
          variantId: payload.variantId,
          masterId: payload.masterId,
          versionId: payload.versionId,
          variantName: payload.variantName,
          status: payload.status,
          eventAt,
        },
        executor,
      );
    }, tx);
  }

  async recordVariantDeleted(payload: ProductVariantDeletedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.deletedAt);
    await this.inTx(async (executor) => {
      await this.upsertVariant(
        {
          variantId: payload.variantId,
          masterId: payload.masterId,
          versionId: payload.versionId,
          status: 'archived',
          deletedAt: eventAt,
          eventAt,
        },
        executor,
      );
    }, tx);
  }

  async recordInventoryManagementChanged(payload: ProductInventoryManagementChangedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.changedAt);
    await this.inTx(async (executor) => {
      await this.upsertMaster(
        {
          masterId: payload.masterId,
          name: payload.productName,
          eventAt,
        },
        executor,
      );

      for (const variant of payload.affectedVariants) {
        await this.upsertVariant(
          {
            variantId: variant.variantId,
            masterId: payload.masterId,
            versionId: payload.versionId,
            variantName: variant.variantName ?? null,
            inventoryManagement: payload.inventoryManagement,
            eventAt,
          },
          executor,
        );
      }
    }, tx);
  }

  async recordMasterActiveVersionChanged(payload: ProductMasterActiveVersionChangedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.changedAt);
    await this.inTx(async (executor) => {
      await this.upsertMaster(
        {
          masterId: payload.masterId,
          name: payload.name ?? null,
          activeVersionId: payload.versionId,
          isActive: payload.versionId !== null,
          lastChangeReason: payload.changeReason,
          // 키 부재(구버전 이벤트·미게시)는 기존 원가 유지, null 은 "원가 지움"으로 반영
          ...(payload.supplyPrice !== undefined ? { supplyPrice: payload.supplyPrice } : {}),
          eventAt,
        },
        executor,
      );

      if (payload.categoryIds) {
        await this.replaceMasterCategories(
          payload.masterId,
          payload.categoryIds,
          payload.primaryCategoryId ?? null,
          executor,
        );
      }
    }, tx);
  }

  async recordMasterDeleted(payload: ProductMasterDeletedPayload, tx?: DbTx): Promise<void> {
    const eventAt = this.parseDate(payload.deletedAt);
    await this.inTx(async (executor) => {
      await this.upsertMaster(
        {
          masterId: payload.masterId,
          isActive: false,
          deletedAt: eventAt,
          eventAt,
        },
        executor,
      );

      await executor.delete(dimProductCategories).where(eq(dimProductCategories.masterId, payload.masterId));
    }, tx);
  }

  private async upsertMaster(patch: MasterPatch, tx: DbTx): Promise<void> {
    const now = new Date();
    const eventAt = patch.eventAt ?? now;
    const values = {
      masterId: patch.masterId,
      name: patch.name ?? null,
      activeVersionId: patch.activeVersionId ?? null,
      isActive: patch.isActive ?? null,
      lastChangeReason: patch.lastChangeReason ?? null,
      supplyPrice: patch.supplyPrice ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: patch.deletedAt ?? null,
      lastEventAt: eventAt,
    };

    // 각 칸의 새 값은 excluded(= 위 values)에서 읽는다. 순서 역전 규칙은 파일 머리 주석.
    const at = dimProductMasters.lastEventAt;
    const set: PgUpdateSetSource<typeof dimProductMasters> = {
      updatedAt: now,
      lastEventAt: latestEventAt(at),
    };

    if (patch.name != null) {
      set.name = fillIfStale(dimProductMasters.name, at);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'activeVersionId')) {
      set.activeVersionId = keepIfStale(dimProductMasters.activeVersionId, at);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'isActive')) {
      set.isActive = fillIfStale(dimProductMasters.isActive, at);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'lastChangeReason')) {
      set.lastChangeReason = fillIfStale(dimProductMasters.lastChangeReason, at);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'supplyPrice')) {
      set.supplyPrice = keepIfStale(dimProductMasters.supplyPrice, at);
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'deletedAt')) {
      set.deletedAt = keepIfStale(dimProductMasters.deletedAt, at);
    }

    await tx.insert(dimProductMasters).values(values).onConflictDoUpdate({
      target: dimProductMasters.masterId,
      set,
    });
  }

  private async upsertVariant(patch: VariantPatch, tx: DbTx): Promise<void> {
    const now = new Date();
    const eventAt = patch.eventAt ?? now;
    const values = {
      variantId: patch.variantId,
      masterId: patch.masterId,
      versionId: patch.versionId,
      variantName: patch.variantName ?? null,
      isDefault: patch.isDefault ?? null,
      status: patch.status ?? null,
      inventoryManagement: patch.inventoryManagement ?? null,
      preStockSellable: patch.preStockSellable ?? null,
      alwaysSellableZeroStock: patch.alwaysSellableZeroStock ?? null,
      createdAt: patch.createdAt ?? now,
      updatedAt: now,
      deletedAt: patch.deletedAt ?? null,
      lastEventAt: eventAt,
    };

    // 각 칸의 새 값은 excluded(= 위 values)에서 읽는다. 순서 역전 규칙은 파일 머리 주석.
    const at = dimProductVariants.lastEventAt;
    const set: PgUpdateSetSource<typeof dimProductVariants> = {
      updatedAt: now,
      lastEventAt: latestEventAt(at),
    };

    if (patch.variantName !== undefined) {
      set.variantName = fillIfStale(dimProductVariants.variantName, at);
    }

    if (patch.isDefault !== undefined) {
      set.isDefault = fillIfStale(dimProductVariants.isDefault, at);
    }

    if (patch.status !== undefined) {
      set.status = fillIfStale(dimProductVariants.status, at);
    }

    if (patch.inventoryManagement !== undefined) {
      set.inventoryManagement = fillIfStale(dimProductVariants.inventoryManagement, at);
    }

    if (patch.preStockSellable !== undefined) {
      set.preStockSellable = fillIfStale(dimProductVariants.preStockSellable, at);
    }

    if (patch.alwaysSellableZeroStock !== undefined) {
      set.alwaysSellableZeroStock = fillIfStale(dimProductVariants.alwaysSellableZeroStock, at);
    }

    if (patch.deletedAt !== undefined) {
      set.deletedAt = keepIfStale(dimProductVariants.deletedAt, at);
    }

    await tx.insert(dimProductVariants).values(values).onConflictDoUpdate({
      target: dimProductVariants.variantId,
      set,
    });
  }

  private async replaceMasterCategories(
    masterId: string,
    categoryIds: string[],
    primaryCategoryId: string | null,
    tx: DbTx,
  ): Promise<void> {
    await tx.delete(dimProductCategories).where(eq(dimProductCategories.masterId, masterId));

    if (categoryIds.length === 0) {
      return;
    }

    const now = new Date();
    await tx.insert(dimProductCategories).values(
      categoryIds.map((categoryId) => ({
        masterId,
        categoryId,
        isPrimary: primaryCategoryId === categoryId,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  private parseDate(value: string): Date {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
