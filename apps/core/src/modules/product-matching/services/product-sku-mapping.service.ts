import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, inArray, sql, and, desc, isNull } from 'drizzle-orm';
import { UpsertMatchingDto } from '../dto/upsert-matching.dto';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { ProductSellableQuantityResult } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.calculator';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { productVariants } from '../../catalog/schema/catalog.schema';
import {
  UpdateVariantStockPolicyDto,
  VariantMatchingBatchItemDto,
  VariantMatchingBatchResponseDto,
} from '../dto/variant-matching-batch.dto';

type StockPolicyPatch = UpsertMatchingDto['policy'] | UpdateVariantStockPolicyDto | undefined;

@Injectable()
export class ProductSkuMappingService {
  private readonly logger = new Logger(ProductSkuMappingService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSellableQuantity: ProductSellableQuantityService,
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  private hasAvailabilityOverride(policy: StockPolicyPatch): boolean {
    return !!policy && Object.prototype.hasOwnProperty.call(policy, 'availabilityOverride');
  }

  private async upsertSalesVariantPolicy(
    trx: DbTx,
    variantId: string,
    policy: StockPolicyPatch,
    fallback: { preStockSellable: boolean; alwaysSellableZeroStock: boolean },
    now = new Date(),
    options: { preserveExistingUnspecified?: boolean } = {},
  ) {
    const preserveExistingUnspecified = options.preserveExistingUnspecified ?? true;
    const existingPolicy = preserveExistingUnspecified
      ? await trx.query.salesVariantPolicies.findFirst({
          where: (p, { eq }) => eq(p.variantId, variantId),
        })
      : null;
    const availabilityOverridePatch = this.hasAvailabilityOverride(policy)
      ? { availabilityOverride: policy?.availabilityOverride ?? null }
      : {};
    const variantPolicyValues = {
      variantId,
      inventoryManagement: true,
      preStockSellable: policy?.preStockSellable ?? existingPolicy?.preStockSellable ?? fallback.preStockSellable,
      alwaysSellableZeroStock:
        policy?.alwaysSellableZeroStock ?? existingPolicy?.alwaysSellableZeroStock ?? fallback.alwaysSellableZeroStock,
      ...availabilityOverridePatch,
      updatedAt: now,
    };

    await trx
      .insert(wmsTables.salesVariantPolicies)
      .values(variantPolicyValues)
      .onConflictDoUpdate({
        target: wmsTables.salesVariantPolicies.variantId,
        set: {
          inventoryManagement: true,
          preStockSellable: variantPolicyValues.preStockSellable,
          alwaysSellableZeroStock: variantPolicyValues.alwaysSellableZeroStock,
          ...availabilityOverridePatch,
          updatedAt: now,
        },
      });
  }

  private toProjectionView(projection: ProductSellableQuantityResult | undefined | null) {
    if (!projection) return null;

    return {
      ...projection,
      calculatedAt: projection.calculatedAt.toISOString(),
    };
  }

  async getVariantMatchingBatch(variantIds: string[], tx?: DbTx): Promise<VariantMatchingBatchResponseDto> {
    if (!Array.isArray(variantIds)) {
      throw new BadRequestException('variantIds must be an array');
    }

    if (variantIds.length > 500) {
      throw new BadRequestException('variantIds must not exceed 500 items');
    }

    if (variantIds.length === 0) {
      return { data: [] };
    }

    return this.inTx(async (trx) => {
      const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))];

      if (uniqueVariantIds.length === 0) {
        return {
          data: variantIds.map((variantId) => ({
            variantId,
            exists: false,
            matching: null,
            stockPolicy: {
              preStockSellable: true,
              alwaysSellableZeroStock: false,
              availabilityOverride: null,
            },
            projection: null,
          })),
        };
      }

      const variants = await (trx as any)
        .select({
          id: productVariants.id,
        })
        .from(productVariants)
        .where(inArray(productVariants.id, uniqueVariantIds));

      const matchings = await trx
        .select({
          id: wmsTables.productMatchings.id,
          variantId: wmsTables.productMatchings.variantId,
          masterId: wmsTables.productMatchings.masterId,
          skuGroupId: wmsTables.productMatchings.skuGroupId,
          status: wmsTables.productMatchings.status,
          priority: wmsTables.productMatchings.priority,
          strategy: wmsTables.productMatchings.strategy,
          isResolved: wmsTables.productMatchings.isResolved,
          preStockSellable: wmsTables.productMatchings.preStockSellable,
          alwaysSellableZeroStock: wmsTables.productMatchings.alwaysSellableZeroStock,
          createdAt: wmsTables.productMatchings.createdAt,
          updatedAt: wmsTables.productMatchings.updatedAt,
        })
        .from(wmsTables.productMatchings)
        .where(inArray(wmsTables.productMatchings.variantId, uniqueVariantIds));

      const policies = await trx
        .select({
          variantId: wmsTables.salesVariantPolicies.variantId,
          preStockSellable: wmsTables.salesVariantPolicies.preStockSellable,
          alwaysSellableZeroStock: wmsTables.salesVariantPolicies.alwaysSellableZeroStock,
          availabilityOverride: wmsTables.salesVariantPolicies.availabilityOverride,
        })
        .from(wmsTables.salesVariantPolicies)
        .where(inArray(wmsTables.salesVariantPolicies.variantId, uniqueVariantIds));

      const matchingIds = matchings.map((matching) => matching.id);
      const links =
        matchingIds.length > 0
          ? await trx
              .select({
                productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId,
                skuId: wmsTables.productVariantSkuLinks.skuId,
                quantity: wmsTables.productVariantSkuLinks.quantity,
                skuName: wmsTables.skus.name,
                skuCode: wmsTables.skus.code,
              })
              .from(wmsTables.productVariantSkuLinks)
              .leftJoin(wmsTables.skus, eq(wmsTables.productVariantSkuLinks.skuId, wmsTables.skus.id))
              .where(inArray(wmsTables.productVariantSkuLinks.productMatchingId, matchingIds))
          : [];

      const projections = await this.productSellableQuantity.getByVariantIds(uniqueVariantIds, trx as any);

      const existingVariantIds = new Set(variants.map((variant) => variant.id));
      const matchingByVariantId = new Map(matchings.map((matching) => [matching.variantId, matching]));
      const policyByVariantId = new Map(policies.map((policy) => [policy.variantId, policy]));
      const projectionByVariantId = new Map(projections.map((projection) => [projection.variantId, projection]));
      const linksByMatchingId = new Map<string, typeof links>();

      for (const link of links) {
        const matchingLinks = linksByMatchingId.get(link.productMatchingId) ?? [];
        matchingLinks.push(link);
        linksByMatchingId.set(link.productMatchingId, matchingLinks);
      }

      const data: VariantMatchingBatchItemDto[] = variantIds.map((variantId) => {
        const matching = matchingByVariantId.get(variantId);
        const policy = policyByVariantId.get(variantId);
        const stockPolicy = {
          preStockSellable: matching?.preStockSellable ?? policy?.preStockSellable ?? true,
          alwaysSellableZeroStock: matching?.alwaysSellableZeroStock ?? policy?.alwaysSellableZeroStock ?? false,
          availabilityOverride: policy?.availabilityOverride ?? null,
        };

        if (!existingVariantIds.has(variantId)) {
          return {
            variantId,
            exists: false,
            matching: null,
            stockPolicy,
            projection: null,
          };
        }

        return {
          variantId,
          exists: true,
          matching: matching
            ? {
                ...matching,
                createdAt: matching.createdAt.toISOString(),
                updatedAt: matching.updatedAt.toISOString(),
                stockPolicy,
                links: (linksByMatchingId.get(matching.id) ?? []).map((link) => ({
                  skuId: link.skuId,
                  skuName: link.skuName ?? undefined,
                  skuCode: link.skuCode ?? undefined,
                  quantity: link.quantity,
                })),
              }
            : null,
          stockPolicy,
          projection: this.toProjectionView(projectionByVariantId.get(variantId)),
        };
      });

      return { data };
    }, tx);
  }

  async getByVariant(variantId: string, tx?: DbTx) {
    return await this.inTx(async (trx) => {
      const matching = await trx.query.productMatchings.findFirst({
        where: (m, { eq }) => eq(m.variantId, variantId),
      });
      if (!matching) return null;
      const policy = await trx.query.salesVariantPolicies.findFirst({
        where: (p, { eq }) => eq(p.variantId, variantId),
      });
      const links = await trx.query.productVariantSkuLinks.findMany({
        where: (l, { eq }) => eq(l.productMatchingId, matching.id),
      });
      return {
        ...matching,
        links,
        stockPolicy: {
          preStockSellable: matching.preStockSellable,
          alwaysSellableZeroStock: matching.alwaysSellableZeroStock,
          availabilityOverride: policy?.availabilityOverride ?? null,
        },
      };
    }, tx);
  }

  async upsert(variantId: string, dto: UpsertMatchingDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!variantId) throw new BadRequestException('variantId required');
      const hasLinks = Array.isArray(dto.links) && dto.links.length > 0;

      if (!hasLinks && dto.policy === undefined) {
        throw new BadRequestException('variant strategy requires at least one SKU link');
      }

      const existing = await trx.query.productMatchings.findFirst({
        where: (m, { eq }) => eq(m.variantId, variantId),
      });
      const hasExplicitEmptyLinks = Array.isArray(dto.links) && dto.links.length === 0;
      const existingLinksForEmptyUpdate =
        existing && hasExplicitEmptyLinks
          ? await trx.query.productVariantSkuLinks.findMany({
              where: (l, { eq }) => eq(l.productMatchingId, existing.id),
            })
          : [];
      const isClearingExistingLinks = hasExplicitEmptyLinks && !!existing && existingLinksForEmptyUpdate.length > 0;
      const isPolicyOnlySave = !hasLinks && !isClearingExistingLinks && dto.policy !== undefined;

      if (isPolicyOnlySave) {
        const now = new Date();
        const matchingPolicyPatch = {
          ...(dto.policy?.preStockSellable !== undefined ? { preStockSellable: dto.policy.preStockSellable } : {}),
          ...(dto.policy?.alwaysSellableZeroStock !== undefined
            ? { alwaysSellableZeroStock: dto.policy.alwaysSellableZeroStock }
            : {}),
          updatedAt: now,
        };

        if (existing && Object.keys(matchingPolicyPatch).length > 1) {
          await trx
            .update(wmsTables.productMatchings)
            .set(matchingPolicyPatch)
            .where(eq(wmsTables.productMatchings.variantId, variantId));
        }

        await this.upsertSalesVariantPolicy(
          trx,
          variantId,
          dto.policy,
          {
            preStockSellable: existing?.preStockSellable ?? true,
            alwaysSellableZeroStock: existing?.alwaysSellableZeroStock ?? false,
          },
          now,
        );

        await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
        return this.getByVariant(variantId, trx);
      }

      const base = {
        variantId: variantId,
        masterId: dto.masterId ?? existing?.masterId ?? null,
        status: 'matched' as const,
        priority: 'normal' as const,
        strategy: 'variant' as const,
        isResolved: true,
        preStockSellable: dto.policy?.preStockSellable ?? true,
        alwaysSellableZeroStock: dto.policy?.alwaysSellableZeroStock ?? false,
      };

      let matchingId: string;
      if (existing) {
        const [row] = await trx
          .update(wmsTables.productMatchings)
          .set(base)
          .where(eq(wmsTables.productMatchings.variantId, variantId))
          .returning();
        matchingId = row.id;
        await trx
          .delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));
      } else {
        const [row] = await trx.insert(wmsTables.productMatchings).values(base).returning();
        matchingId = row.id;
      }

      if (Array.isArray(dto.links) && dto.links.length > 0) {
        await trx.insert(wmsTables.productVariantSkuLinks).values(
          dto.links.map((l) => ({
            productMatchingId: matchingId,
            skuId: l.skuId,
            quantity: Math.max(1, l.quantity),
          })),
        );
      }

      await this.upsertSalesVariantPolicy(
        trx,
        variantId,
        dto.policy,
        {
          preStockSellable: base.preStockSellable,
          alwaysSellableZeroStock: base.alwaysSellableZeroStock,
        },
        undefined,
        { preserveExistingUnspecified: false },
      );

      await trx
        .update(wmsTables.salesOrderLines)
        .set({ productMatchingId: matchingId })
        .where(eq(wmsTables.salesOrderLines.variantId, variantId));

      await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
      await this.fulfillmentBacklog.wakeBacklogsWaitingForVariant(variantId, trx);

      return this.getByVariant(variantId, trx);
    }, tx);
  }

  async updateVariantStockPolicy(variantId: string, dto: UpdateVariantStockPolicyDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!variantId) throw new BadRequestException('variantId required');

      const policy: UpdateVariantStockPolicyDto = dto ?? {};
      const [variant] = await (trx as any)
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1);

      if (!variant) {
        throw new NotFoundException(`Variant not found: ${variantId}`);
      }

      const existing = await trx.query.productMatchings.findFirst({
        where: (m, { eq }) => eq(m.variantId, variantId),
      });
      const now = new Date();
      const matchingPolicyPatch = {
        ...(policy.preStockSellable !== undefined ? { preStockSellable: policy.preStockSellable } : {}),
        ...(policy.alwaysSellableZeroStock !== undefined
          ? { alwaysSellableZeroStock: policy.alwaysSellableZeroStock }
          : {}),
        updatedAt: now,
      };

      if (existing && Object.keys(matchingPolicyPatch).length > 1) {
        await trx
          .update(wmsTables.productMatchings)
          .set(matchingPolicyPatch)
          .where(eq(wmsTables.productMatchings.variantId, variantId));
      }

      await this.upsertSalesVariantPolicy(
        trx,
        variantId,
        policy,
        {
          preStockSellable: existing?.preStockSellable ?? true,
          alwaysSellableZeroStock: existing?.alwaysSellableZeroStock ?? false,
        },
        now,
      );

      await this.productSellableQuantity.recalculateAndPublishForVariant(variantId, trx);
      const response = await this.getVariantMatchingBatch([variantId], trx);
      return response.data[0];
    }, tx);
  }

  /**
   * variant에 대한 SKU 매핑 스냅샷을 생성한다.
   * SO 확정 시 각 라인별로 호출하여 해당 시점의 매핑을 동결한다.
   * @returns 생성된 스냅샷 ID, 매핑이 없으면 null
   */
  async createSnapshotForVariant(variantId: string, warehouseId: string, tx?: DbTx): Promise<string | null> {
    return this.inTx(async (trx) => {
      // 1. 현재 활성 SKU 매핑 조회 (productSkuMappings + productSkuMappingItems)
      const mappingInfo = await trx
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
        // Fallback: productMatchings (Global Matching) 확인
        const globalMatching = await this.getByVariant(variantId, trx);

        if (globalMatching && globalMatching.links && globalMatching.links.length > 0) {
          const primaryLink = globalMatching.links[0];
          const [snapshot] = await trx
            .insert(wmsTables.productSkuMappingSnapshots)
            .values({
              productId: globalMatching.masterId ?? 'unknown',
              sourceVersion: 0,
              warehouseId,
              variantId,
              skuId: primaryLink.skuId,
              quantity: primaryLink.quantity,
              mappingId: null,
              snapshotData: {
                items: globalMatching.links.map((l) => ({ skuId: l.skuId, qtyPerProduct: l.quantity })),
                capturedAt: new Date().toISOString(),
                source: 'global_matching',
              },
            })
            .returning();

          this.logger.log(
            `Created fallback snapshot from global matching for variantId=${variantId}: snapshotId=${snapshot.id}`,
          );
          return snapshot.id;
        }

        this.logger.warn(`No active mapping found for variantId=${variantId}, warehouseId=${warehouseId}`);
        return null;
      }

      const { mappingId, productId, version, skuId, quantity } = mappingInfo[0];

      // 2. 스냅샷 생성
      const [snapshot] = await trx
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

      this.logger.log(`Created mapping snapshot for variantId=${variantId}: snapshotId=${snapshot.id}`);
      return snapshot.id;
    }, tx);
  }

  async getActiveMapping(
    productId: string,
    warehouseId: string,
    tx?: DbTx,
  ): Promise<{
    id: string;
    productId: string;
    warehouseId: string;
    version: number;
    isActive: boolean;
    mappings: Array<{ variantId: string; skuId: string; quantity: number }>;
  } | null> {
    return this.inTx(async (trx) => {
      const mappings = await trx
        .select()
        .from(wmsTables.productSkuMappings)
        .where(
          and(
            eq(wmsTables.productSkuMappings.productId, productId),
            eq(wmsTables.productSkuMappings.warehouseId, warehouseId),
            eq(wmsTables.productSkuMappings.isActive, true),
          ),
        )
        .orderBy(desc(wmsTables.productSkuMappings.version))
        .limit(1);

      const mapping = mappings[0];
      if (!mapping) return null;

      const items = await trx
        .select()
        .from(wmsTables.productSkuMappingItems)
        .where(eq(wmsTables.productSkuMappingItems.mappingId, mapping.id));

      return {
        id: mapping.id,
        productId: mapping.productId,
        warehouseId: mapping.warehouseId,
        version: mapping.version,
        isActive: mapping.isActive,
        mappings: items.map((item) => ({
          variantId: item.variantId,
          skuId: item.skuId,
          quantity: item.qtyPerProduct,
        })),
      };
    }, tx);
  }

  async getMappingSnapshot(
    snapshotId: string,
    tx?: DbTx,
  ): Promise<{
    id: string;
    productId: string;
    version: number;
    effectiveFrom: Date;
    isActive: boolean;
    warehouseId: string;
    mappings: Array<{ variantId: string; skuId: string; quantity: number }>;
  }> {
    return this.inTx(async (trx) => {
      const snapshots = await trx
        .select()
        .from(wmsTables.productSkuMappingSnapshots)
        .where(eq(wmsTables.productSkuMappingSnapshots.id, snapshotId))
        .limit(1);
      const snapshot = snapshots[0];
      if (!snapshot) {
        throw new NotFoundException(`Mapping snapshot with ID ${snapshotId} not found`);
      }
      const data = snapshot.snapshotData as { items: Array<{ skuId: string; qtyPerProduct: number }> };
      const items = data?.items || [];
      return {
        id: snapshot.id,
        productId: snapshot.productId,
        version: snapshot.sourceVersion,
        effectiveFrom: snapshot.createdAt,
        isActive: true,
        warehouseId: snapshot.warehouseId,
        mappings: items.map((item) => ({
          variantId: snapshot.variantId,
          skuId: item.skuId,
          quantity: item.qtyPerProduct,
        })),
      };
    }, tx);
  }

  async getMastersBatchStats(masterIds: string[], tx?: DbTx) {
    return this.inTx(async (trx) => {
      if (!masterIds || masterIds.length === 0) {
        return [];
      }

      const results = await trx
        .select({
          masterId: wmsTables.productMatchings.masterId,
          totalVariants: sql<number>`count(*)::int`,
          matchedVariants: sql<number>`count(*) FILTER (
            WHERE ${wmsTables.productMatchings.status} = 'matched'
              AND (
                ${wmsTables.productMatchings.strategy} = 'void'
                OR (
                  ${wmsTables.productMatchings.strategy} = 'variant'
                  AND EXISTS (
                    SELECT 1
                    FROM ${wmsTables.productVariantSkuLinks}
                    WHERE ${wmsTables.productVariantSkuLinks.productMatchingId} = ${wmsTables.productMatchings.id}
                  )
                )
              )
          )::int`,
          pendingVariants: sql<number>`count(*) FILTER (
            WHERE ${wmsTables.productMatchings.status} = 'pending'
              OR (
                ${wmsTables.productMatchings.status} = 'matched'
                AND ${wmsTables.productMatchings.strategy} IS NULL
              )
              OR (
                ${wmsTables.productMatchings.status} = 'matched'
                AND ${wmsTables.productMatchings.strategy} = 'variant'
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${wmsTables.productVariantSkuLinks}
                  WHERE ${wmsTables.productVariantSkuLinks.productMatchingId} = ${wmsTables.productMatchings.id}
                )
              )
          )::int`,
          ignoredVariants: sql<number>`count(*) FILTER (WHERE ${wmsTables.productMatchings.status} = 'ignored')::int`,
        })
        .from(wmsTables.productMatchings)
        .where(inArray(wmsTables.productMatchings.masterId, masterIds))
        .groupBy(wmsTables.productMatchings.masterId);

      const statsMap = results.reduce(
        (acc, stat) => {
          if (stat.masterId) {
            acc[stat.masterId] = {
              totalVariants: stat.totalVariants,
              matchedVariants: stat.matchedVariants,
              pendingVariants: stat.pendingVariants,
              ignoredVariants: stat.ignoredVariants,
              matchingRate: stat.totalVariants > 0 ? Math.round((stat.matchedVariants / stat.totalVariants) * 100) : 0,
            };
          }
          return acc;
        },
        {} as Record<
          string,
          {
            totalVariants: number;
            matchedVariants: number;
            pendingVariants: number;
            ignoredVariants: number;
            matchingRate: number;
          }
        >,
      );

      return masterIds.map((masterId) => ({
        masterId,
        ...(statsMap[masterId] || {
          totalVariants: 0,
          matchedVariants: 0,
          pendingVariants: 0,
          ignoredVariants: 0,
          matchingRate: 0,
        }),
      }));
    }, tx);
  }
}
