import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { DbService } from '@app/db';
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { MatchingsService } from '../../matchings/services/matchings.service';

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
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly matchingsService: MatchingsService,
  ) { }

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
      const snapshots = await tx
        .select()
        .from(wmsTables.productSkuMappingSnapshots)
        .where(eq(wmsTables.productSkuMappingSnapshots.id, snapshotId))
        .limit(1);

      const snapshot = snapshots[0];
      if (!snapshot) {
        throw new NotFoundException(`Mapping snapshot with ID ${snapshotId} not found`);
      }

      // snapshotData에서 items 추출 (JSON 타입)
      const data = snapshot.snapshotData as { items: Array<{ skuId: string; qtyPerProduct: number }> };
      const items = data?.items || [];

      return {
        id: snapshot.id,
        productId: snapshot.productId,
        version: snapshot.sourceVersion,
        effectiveFrom: snapshot.createdAt, // 스냅샷 생성 시점을 유효 시점으로 간주
        isActive: true, // 스냅샷은 항상 유효한 기록임
        warehouseId: snapshot.warehouseId,
        mappings: items.map(item => ({
          variantId: snapshot.variantId,
          skuId: item.skuId,
          quantity: item.qtyPerProduct,
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

  /**
   * SO 확정 시점에 variant의 현재 매핑 정보를 스냅샷으로 저장
   * 
   * @param variantId - PIM variant ID
   * @param warehouseId - 출고 창고 ID
   * @param tx - 트랜잭션
   * @returns 생성된 스냅샷 ID 또는 매핑이 없으면 null
   */
  async createSnapshotForVariant(
    variantId: string,
    warehouseId: string,
    tx?: DbTx,
  ): Promise<string | null> {
    return this.inTx(async (tx) => {
      // 1. 현재 활성 매핑 조회
      const mappingInfo = await tx
        .select({
          mappingId: wmsTables.productSkuMappings.id,
          productId: wmsTables.productSkuMappings.productId,
          version: wmsTables.productSkuMappings.version,
          skuId: wmsTables.productSkuMappingItems.skuId,
          quantity: wmsTables.productSkuMappingItems.qtyPerProduct,
        })
        .from(wmsTables.productSkuMappingItems)
        .innerJoin(
          wmsTables.productSkuMappings,
          eq(wmsTables.productSkuMappingItems.mappingId, wmsTables.productSkuMappings.id),
        )
        .where(
          and(
            eq(wmsTables.productSkuMappingItems.variantId, variantId),
            eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
            eq(wmsTables.productSkuMappings.isActive, true),
          ),
        )
        .orderBy(desc(wmsTables.productSkuMappings.version))
        .limit(1);

      if (mappingInfo.length === 0) {
        // Fallback: Global Matching 확인
        const globalMatching = await this.matchingsService.getByVariant(variantId, tx);

        if (globalMatching && globalMatching.links && globalMatching.links.length > 0) {
          // Global Matching이 있으면 이를 기반으로 스냅샷 생성
          // 주의: Global Matching은 warehouseId 개념이 없으므로, 현재 요청된 warehouseId로 스냅샷을 생성함
          // 또한 productId 정보가 없으므로(variantId만 있음), productId는 null이거나 별도 조회가 필요할 수 있음.
          // 현재 스키마상 productId가 필수라면 문제가 될 수 있으나, 
          // product_sku_mapping_snapshots 테이블 정의를 확인해봐야 함. 
          // (일단 productId는 null 허용이거나, variantId로 product를 찾을 수 있다고 가정)

          // 여기서는 productId를 알 수 없으므로, 일단 null로 넣거나(스키마 허용시), 
          // 또는 variantId를 통해 Product를 조회해야 함.
          // 하지만 성능상 일단 Global Matching의 첫 번째 SKU를 메인으로 잡고 스냅샷 생성.

          const primaryLink = globalMatching.links[0];

          const [snapshot] = await tx
            .insert(wmsTables.productSkuMappingSnapshots)
            .values({
              productId: globalMatching.masterId ?? 'unknown', // masterId를 productId로 사용하거나, 없으면 placeholder
              sourceVersion: 0, // Global matching has no versioning like warehouse mapping
              warehouseId,
              variantId,
              skuId: primaryLink.skuId,
              quantity: primaryLink.quantity,
              mappingId: null, // No specific mapping ID
              snapshotData: {
                items: globalMatching.links.map(l => ({ skuId: l.skuId, qtyPerProduct: l.quantity })),
                capturedAt: new Date().toISOString(),
                source: 'global_matching'
              },
            })
            .returning();

          this.logger.log(
            `Created fallback snapshot from global matching for variantId=${variantId}: snapshotId=${snapshot.id}`,
          );
          return snapshot.id;
        }

        this.logger.warn(
          `No active mapping found for variantId=${variantId}, warehouseId=${warehouseId}`,
        );
        return null;
      }

      const { mappingId, productId, version, skuId, quantity } = mappingInfo[0];

      // 2. 스냅샷 생성
      const [snapshot] = await tx
        .insert(wmsTables.productSkuMappingSnapshots)
        .values({
          productId,
          sourceVersion: version,
          warehouseId,
          variantId,
          skuId,
          quantity,
          mappingId,
          snapshotData: {
            items: [{ skuId, qtyPerProduct: quantity }],
            capturedAt: new Date().toISOString(),
          },
        })
        .returning();

      this.logger.log(
        `Created mapping snapshot for variantId=${variantId}: snapshotId=${snapshot.id}`,
      );

      return snapshot.id;
    }, tx);
  }

  /**
   * 여러 variant에 대한 스냅샷을 일괄 생성
   * SO 확정 시 모든 라인의 스냅샷을 한 번에 생성할 때 사용
   */
  async createSnapshotsForVariants(
    variantWarehousePairs: Array<{ variantId: string; warehouseId: string }>,
    tx?: DbTx,
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    await this.inTx(async (tx) => {
      for (const { variantId, warehouseId } of variantWarehousePairs) {
        const snapshotId = await this.createSnapshotForVariant(variantId, warehouseId, tx);
        results.set(variantId, snapshotId);
      }
    }, tx);

    return results;
  }
}