import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, desc, isNull } from 'drizzle-orm';

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

  async createMapping(dto: CreateMappingDto): Promise<void> {
    const { productId, variantId, skuId, warehouseId, quantity = 1 } = dto;

    await this.db.transaction(async (tx) => {
      const currentMapping = await tx.query.productSkuMappings.findFirst({
        where: and(
          eq(wmsTables.productSkuMappings.productId, productId),
          eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
          eq(wmsTables.productSkuMappings.isActive, true)
        ),
        orderBy: desc(wmsTables.productSkuMappings.version)
      });

      const newVersion = (currentMapping?.version || 0) + 1;

      if (currentMapping) {
        await tx.update(wmsTables.productSkuMappings)
          .set({ isActive: false })
          .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));
      }

      const [newMapping] = await tx.insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: newVersion,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      await tx.insert(wmsTables.productSkuMappingSnapshots)
        .values({
          mappingId: newMapping.id,
          variantId,
          skuId,
          quantity
        });

      this.logger.log(`Created product-SKU mapping: productId=${productId}, version=${newVersion}, variantId=${variantId}, skuId=${skuId}`);
    });
  }

  async getActiveMapping(productId: string, warehouseId: string): Promise<MappingSnapshot | null> {
    const mapping = await this.db.query.productSkuMappings.findFirst({
      where: and(
        eq(wmsTables.productSkuMappings.productId, productId),
        eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
        eq(wmsTables.productSkuMappings.isActive, true)
      ),
      with: {
        snapshots: true
      }
    });

    if (!mapping) {
      return null;
    }

    return {
      id: mapping.id,
      productId: mapping.productId,
      version: mapping.version,
      effectiveFrom: mapping.effectiveFrom!,
      isActive: mapping.isActive,
      warehouseId: mapping.warehouseId,
      mappings: mapping.snapshots.map(snapshot => ({
        variantId: snapshot.variantId,
        skuId: snapshot.skuId,
        quantity: snapshot.quantity
      }))
    };
  }

  async getMappingSnapshot(snapshotId: string): Promise<MappingSnapshot> {
    const mapping = await this.db.query.productSkuMappings.findFirst({
      where: eq(wmsTables.productSkuMappings.id, snapshotId),
      with: {
        snapshots: true
      }
    });

    if (!mapping) {
      throw new NotFoundException(`Mapping snapshot with ID ${snapshotId} not found`);
    }

    return {
      id: mapping.id,
      productId: mapping.productId,
      version: mapping.version,
      effectiveFrom: mapping.effectiveFrom!,
      isActive: mapping.isActive,
      warehouseId: mapping.warehouseId,
      mappings: mapping.snapshots.map(snapshot => ({
        variantId: snapshot.variantId,
        skuId: snapshot.skuId,
        quantity: snapshot.quantity
      }))
    };
  }

  async addVariantToMapping(productId: string, warehouseId: string, variantId: string, skuId: string, quantity = 1): Promise<void> {
    const currentMapping = await this.getActiveMapping(productId, warehouseId);

    if (!currentMapping) {
      await this.createMapping({ productId, variantId, skuId, warehouseId, quantity });
      return;
    }

    const existingVariant = currentMapping.mappings.find(m => m.variantId === variantId);
    if (existingVariant) {
      throw new BadRequestException(`Variant ${variantId} already exists in mapping for product ${productId}`);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.productSkuMappings)
        .set({ isActive: false })
        .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

      const [newMapping] = await tx.insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: currentMapping.version + 1,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      const allMappings = [...currentMapping.mappings, { variantId, skuId, quantity }];

      await tx.insert(wmsTables.productSkuMappingSnapshots)
        .values(allMappings.map(mapping => ({
          mappingId: newMapping.id,
          variantId: mapping.variantId,
          skuId: mapping.skuId,
          quantity: mapping.quantity
        })));

      this.logger.log(`Added variant ${variantId} to product ${productId} mapping, new version: ${currentMapping.version + 1}`);
    });
  }

  async removeVariantFromMapping(productId: string, warehouseId: string, variantId: string): Promise<void> {
    const currentMapping = await this.getActiveMapping(productId, warehouseId);

    if (!currentMapping) {
      throw new NotFoundException(`No active mapping found for product ${productId} in warehouse ${warehouseId}`);
    }

    const variantExists = currentMapping.mappings.some(m => m.variantId === variantId);
    if (!variantExists) {
      throw new NotFoundException(`Variant ${variantId} not found in mapping for product ${productId}`);
    }

    if (currentMapping.mappings.length === 1) {
      await this.db.update(wmsTables.productSkuMappings)
        .set({ isActive: false })
        .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

      this.logger.log(`Deactivated mapping for product ${productId} (last variant removed)`);
      return;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(wmsTables.productSkuMappings)
        .set({ isActive: false })
        .where(eq(wmsTables.productSkuMappings.id, currentMapping.id));

      const [newMapping] = await tx.insert(wmsTables.productSkuMappings)
        .values({
          productId,
          version: currentMapping.version + 1,
          warehouseId,
          isActive: true,
          effectiveFrom: new Date()
        })
        .returning();

      const remainingMappings = currentMapping.mappings.filter(m => m.variantId !== variantId);

      await tx.insert(wmsTables.productSkuMappingSnapshots)
        .values(remainingMappings.map(mapping => ({
          mappingId: newMapping.id,
          variantId: mapping.variantId,
          skuId: mapping.skuId,
          quantity: mapping.quantity
        })));

      this.logger.log(`Removed variant ${variantId} from product ${productId} mapping, new version: ${currentMapping.version + 1}`);
    });
  }

  async getMappingHistory(productId: string, warehouseId: string): Promise<MappingSnapshot[]> {
    const mappings = await this.db.query.productSkuMappings.findMany({
      where: and(
        eq(wmsTables.productSkuMappings.productId, productId),
        eq(wmsTables.productSkuMappings.warehouseId, warehouseId)
      ),
      orderBy: desc(wmsTables.productSkuMappings.version),
      with: {
        snapshots: true
      }
    });

    return mappings.map(mapping => ({
      id: mapping.id,
      productId: mapping.productId,
      version: mapping.version,
      effectiveFrom: mapping.effectiveFrom!,
      isActive: mapping.isActive,
      warehouseId: mapping.warehouseId,
      mappings: mapping.snapshots.map(snapshot => ({
        variantId: snapshot.variantId,
        skuId: snapshot.skuId,
        quantity: snapshot.quantity
      }))
    }));
  }

  async getSkuMappingForVariant(variantId: string, warehouseId: string): Promise<{ skuId: string; quantity: number } | null> {
    const snapshot = await this.db.query.productSkuMappingSnapshots.findFirst({
      where: eq(wmsTables.productSkuMappingSnapshots.variantId, variantId),
      with: {
        mapping: {
          where: and(
            eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
            eq(wmsTables.productSkuMappings.isActive, true)
          )
        }
      }
    });

    if (!snapshot || !snapshot.mapping) {
      return null;
    }

    return {
      skuId: snapshot.skuId,
      quantity: snapshot.quantity
    };
  }

  async validateMapping(productId: string, warehouseId: string): Promise<boolean> {
    const mapping = await this.getActiveMapping(productId, warehouseId);

    if (!mapping || mapping.mappings.length === 0) {
      return false;
    }

    for (const mappingEntry of mapping.mappings) {
      const sku = await this.db.query.skus.findFirst({
        where: eq(wmsTables.skus.id, mappingEntry.skuId)
      });

      if (!sku) {
        this.logger.warn(`Invalid SKU reference in mapping: ${mappingEntry.skuId}`);
        return false;
      }
    }

    return true;
  }
}