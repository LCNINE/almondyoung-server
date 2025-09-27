import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

export interface CreateMappingDto {
  productId: string;
  variantId: string;
  skuId: string;
  warehouseId: string;
  quantity?: number;
}

export interface MappingSnapshot {
  id: string;
  productId: string;
  version: number;
  effectiveFrom: Date;
  isActive: boolean;
  warehouseId: string;
  mappings: Array<{
    variantId: string;
    skuId: string;
    quantity: number;
  }>;
}

@Injectable()
export class ProductSkuMappingService {
  private readonly logger = new Logger(ProductSkuMappingService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async createMapping(dto: CreateMappingDto, tx?: DbTx): Promise<void> {
    const { productId, variantId, skuId, warehouseId, quantity = 1 } = dto;

    await this.inTx(async (tx) => {
      const existing = await tx
        .select()
        .from(wmsTables.productSkuMappings)
        .where(and(
          eq(wmsTables.productSkuMappings.productId, productId),
          eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
          eq(wmsTables.productSkuMappings.isActive, true)
        ))
        .orderBy(desc(wmsTables.productSkuMappings.version))
        .limit(1);

      const currentMapping = existing[0];
      const newVersion = (currentMapping?.version ?? 0) + 1;

      if (currentMapping) {
        await tx
          .update(wmsTables.productSkuMappings)
          .set({ isActive: false })
          .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));
      }

      const inserted = await tx
        .insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: newVersion,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      const newMapping = inserted[0];

      await tx.insert(wmsTables.productSkuMappingItems).values({
        mappingId: newMapping.id,
        variantId,
        skuId,
        qtyPerProduct: quantity,
      });

      this.logger.log(`Created product-SKU mapping: productId=${productId}, version=${newVersion}, variantId=${variantId}, skuId=${skuId}`);
    }, tx);
  }

  async getActiveMapping(productId: string, warehouseId: string, tx?: DbTx): Promise<MappingSnapshot | null> {
    return this.inTx(async (tx) => {
      const rows = await tx
        .select()
        .from(wmsTables.productSkuMappings)
        .where(and(
          eq(wmsTables.productSkuMappings.productId, productId),
          eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
          eq(wmsTables.productSkuMappings.isActive, true)
        ))
        .orderBy(desc(wmsTables.productSkuMappings.version))
        .limit(1);

      const mapping = rows[0];
      if (!mapping) return null;

      const items = await tx
        .select()
        .from(wmsTables.productSkuMappingItems)
        .where(eq(wmsTables.productSkuMappingItems.mappingId, mapping.id));

      return {
        id: mapping.id,
        productId: mapping.productId,
        version: mapping.version,
        effectiveFrom: mapping.effectiveFrom!,
        isActive: mapping.isActive,
        warehouseId: mapping.warehouseId,
        mappings: items.map(i => ({
          variantId: i.variantId,
          skuId: i.skuId,
          quantity: i.qtyPerProduct,
        })),
      };
    }, tx);
  }

  async getMappingSnapshot(snapshotId: string, tx?: DbTx): Promise<MappingSnapshot> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(wmsTables.productSkuMappings)
        .where(eq(wmsTables.productSkuMappings.id, snapshotId))
        .limit(1);

      const mapping = mappings[0];
      if (!mapping) {
        throw new NotFoundException(`Mapping snapshot with ID ${snapshotId} not found`);
      }

      const snapshots = await tx
        .select()
        .from(wmsTables.productSkuMappingSnapshots)
        .where(eq(wmsTables.productSkuMappingSnapshots.mappingId, mapping.id));

      return {
        id: mapping.id,
        productId: mapping.productId,
        version: mapping.version,
        effectiveFrom: mapping.effectiveFrom!,
        isActive: mapping.isActive,
        warehouseId: mapping.warehouseId,
        mappings: snapshots.map(s => ({
          variantId: s.variantId,
          skuId: s.skuId!,
          quantity: s.quantity,
        })),
      };
    }, tx);
  }

  async addVariantToMapping(productId: string, warehouseId: string, variantId: string, skuId: string, quantity = 1, tx?: DbTx): Promise<void> {
    await this.inTx(async (tx) => {
      const currentMapping = await this.getActiveMapping(productId, warehouseId, tx);

      if (!currentMapping) {
        await this.createMapping({ productId, variantId, skuId, warehouseId, quantity }, tx);
        return;
      }

      const existingVariant = currentMapping.mappings.find(m => m.variantId === variantId);
      if (existingVariant) {
        throw new BadRequestException(`Variant ${variantId} already exists in mapping for product ${productId}`);
      }

      await tx
        .update(wmsTables.productSkuMappings)
        .set({ isActive: false })
        .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

      const inserted = await tx
        .insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: currentMapping.version + 1,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      const newMapping = inserted[0];

      const allMappings = [...currentMapping.mappings, { variantId, skuId, quantity }];

      await tx.insert(wmsTables.productSkuMappingItems).values(
        allMappings.map(m => ({
          mappingId: newMapping.id,
          variantId: m.variantId,
          skuId: m.skuId,
          qtyPerProduct: m.quantity,
        }))
      );

      this.logger.log(`Added variant ${variantId} to product ${productId} mapping, new version: ${currentMapping.version + 1}`);
    }, tx);
  }

  async removeVariantFromMapping(productId: string, warehouseId: string, variantId: string, tx?: DbTx): Promise<void> {
    await this.inTx(async (tx) => {
      const currentMapping = await this.getActiveMapping(productId, warehouseId, tx);

      if (!currentMapping) {
        throw new NotFoundException(`No active mapping found for product ${productId} in warehouse ${warehouseId}`);
      }

      const variantExists = currentMapping.mappings.some(m => m.variantId === variantId);
      if (!variantExists) {
        throw new NotFoundException(`Variant ${variantId} not found in mapping for product ${productId}`);
      }

      if (currentMapping.mappings.length === 1) {
        await tx
          .update(wmsTables.productSkuMappings)
          .set({ isActive: false })
          .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

        this.logger.log(`Deactivated mapping for product ${productId} (last variant removed)`);
        return;
      }

      await tx
        .update(wmsTables.productSkuMappings)
        .set({ isActive: false })
        .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

      const inserted = await tx
        .insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: currentMapping.version + 1,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      const newMapping = inserted[0];

      const remainingMappings = currentMapping.mappings.filter(m => m.variantId !== variantId);

      await tx.insert(wmsTables.productSkuMappingItems).values(
        remainingMappings.map(m => ({
          mappingId: newMapping.id,
          variantId: m.variantId,
          skuId: m.skuId,
          qtyPerProduct: m.quantity,
        }))
      );

      this.logger.log(`Removed variant ${variantId} from product ${productId} mapping, new version: ${currentMapping.version + 1}`);
    }, tx);
  }

  async getMappingHistory(productId: string, warehouseId: string, tx?: DbTx): Promise<MappingSnapshot[]> {
    return this.inTx(async (tx) => {
      const mappings = await tx
        .select()
        .from(wmsTables.productSkuMappings)
        .where(and(
          eq(wmsTables.productSkuMappings.productId, productId),
          eq(wmsTables.productSkuMappings.warehouseId, warehouseId)
        ))
        .orderBy(desc(wmsTables.productSkuMappings.version));

      if (mappings.length === 0) return [];

      const mappingIds = mappings.map(m => m.id);

      const items = await tx
        .select()
        .from(wmsTables.productSkuMappingItems)
        .where(inArray(wmsTables.productSkuMappingItems.mappingId, mappingIds));

      type ItemRow = InferSelectModel<typeof wmsTables.productSkuMappingItems>;
      const grouped: Record<string, ItemRow[]> = {};
      for (const it of items) {
        (grouped[it.mappingId] ||= []).push(it);
      }

      return mappings.map(mapping => ({
        id: mapping.id,
        productId: mapping.productId,
        version: mapping.version,
        effectiveFrom: mapping.effectiveFrom!,
        isActive: mapping.isActive,
        warehouseId: mapping.warehouseId,
        mappings: (grouped[mapping.id] || []).map(i => ({
          variantId: i.variantId,
          skuId: i.skuId,
          quantity: i.qtyPerProduct,
        })),
      }));
    }, tx);
  }

  async getSkuMappingForVariant(variantId: string, warehouseId: string, tx?: DbTx): Promise<{ skuId: string; quantity: number } | null> {
    return this.inTx(async (tx) => {
      const rows = await tx
        .select({
          skuId: wmsTables.productSkuMappingItems.skuId,
          quantity: wmsTables.productSkuMappingItems.qtyPerProduct,
        })
        .from(wmsTables.productSkuMappingItems)
        .innerJoin(
          wmsTables.productSkuMappings,
          eq(wmsTables.productSkuMappingItems.mappingId, wmsTables.productSkuMappings.id)
        )
        .where(and(
          eq(wmsTables.productSkuMappingItems.variantId, variantId),
          eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
          eq(wmsTables.productSkuMappings.isActive, true)
        ))
        .orderBy(desc(wmsTables.productSkuMappings.version))
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      return { skuId: row.skuId, quantity: row.quantity };
    }, tx);
  }

  async validateMapping(productId: string, warehouseId: string, tx?: DbTx): Promise<boolean> {
    return this.inTx(async (tx) => {
      const mapping = await this.getActiveMapping(productId, warehouseId, tx);
      if (!mapping || mapping.mappings.length === 0) return false;

      for (const mappingEntry of mapping.mappings) {
        const rows = await tx
          .select()
          .from(wmsTables.skus)
          .where(eq(wmsTables.skus.id, mappingEntry.skuId))
          .limit(1);
        if (!rows[0]) {
          this.logger.warn(`Invalid SKU reference in mapping: ${mappingEntry.skuId}`);
          return false;
        }
      }

      return true;
    }, tx);
  }
}