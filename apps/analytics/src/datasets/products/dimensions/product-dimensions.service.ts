import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
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

type MasterPatch = {
  masterId: string;
  name?: string | null;
  activeVersionId?: string | null;
  isActive?: boolean | null;
  lastChangeReason?: string | null;
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
      createdAt: now,
      updatedAt: now,
      deletedAt: patch.deletedAt ?? null,
      lastEventAt: eventAt,
    };

    const set: Partial<typeof values> = {
      updatedAt: now,
      lastEventAt: eventAt,
    };

    if (patch.name != null) {
      set.name = patch.name;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'activeVersionId')) {
      set.activeVersionId = patch.activeVersionId ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'isActive')) {
      set.isActive = patch.isActive ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'lastChangeReason')) {
      set.lastChangeReason = patch.lastChangeReason ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'deletedAt')) {
      set.deletedAt = patch.deletedAt ?? null;
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

    const set: Partial<typeof values> = {
      updatedAt: now,
      lastEventAt: eventAt,
    };

    if (patch.variantName !== undefined) {
      set.variantName = patch.variantName ?? null;
    }

    if (patch.isDefault !== undefined) {
      set.isDefault = patch.isDefault ?? null;
    }

    if (patch.status !== undefined) {
      set.status = patch.status ?? null;
    }

    if (patch.inventoryManagement !== undefined) {
      set.inventoryManagement = patch.inventoryManagement ?? null;
    }

    if (patch.preStockSellable !== undefined) {
      set.preStockSellable = patch.preStockSellable ?? null;
    }

    if (patch.alwaysSellableZeroStock !== undefined) {
      set.alwaysSellableZeroStock = patch.alwaysSellableZeroStock ?? null;
    }

    if (patch.deletedAt !== undefined) {
      set.deletedAt = patch.deletedAt ?? null;
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
