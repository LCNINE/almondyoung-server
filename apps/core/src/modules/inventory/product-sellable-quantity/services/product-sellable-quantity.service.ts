import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService, InjectTypedDb } from '@app/db';
import { TypedDatabase } from '@app/db/types';
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { ProductSellableQuantityChangedPayload } from '@packages/event-contracts';
import { MergedSchema } from '../../../../platform/database/merged-schema';
import {
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
} from '../../../catalog/schema/catalog.schema';
import { stockSummary, wmsTables } from '../../schema/inventory.schema';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  calculateProductSellableQuantity,
  ProductSellableQuantityInput,
  ProductSellableQuantityResult,
} from './product-sellable-quantity.calculator';

type ProductSellableQuantityDbTx = Parameters<Parameters<TypedDatabase<MergedSchema>['transaction']>[0]>[0];

@Injectable()
export class ProductSellableQuantityService {
  private readonly logger = new Logger(ProductSellableQuantityService.name);
  private isRefreshingSalesPeriodProjections = false;

  constructor(
    @InjectTypedDb<MergedSchema>()
    private readonly dbService: DbService<MergedSchema>,
    private readonly outbox: OutboxService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(
    fn: (tx: ProductSellableQuantityDbTx) => Promise<T>,
    tx?: ProductSellableQuantityDbTx,
  ): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  private asTx(tx?: unknown): ProductSellableQuantityDbTx | undefined {
    return tx as ProductSellableQuantityDbTx | undefined;
  }

  async getByVariantId(variantId: string, tx?: ProductSellableQuantityDbTx): Promise<ProductSellableQuantityResult> {
    const [projection] = await this.getByVariantIds([variantId], tx);

    if (!projection) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    return projection;
  }

  async getByVariantIds(
    variantIds: string[],
    tx?: ProductSellableQuantityDbTx,
  ): Promise<ProductSellableQuantityResult[]> {
    const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))];

    if (uniqueVariantIds.length === 0) {
      return [];
    }

    return this.inTx(async (trx) => {
      const variantRows = await trx
        .select({
          id: productVariants.id,
          status: productVariants.status,
        })
        .from(productVariants)
        .where(inArray(productVariants.id, uniqueVariantIds));

      if (variantRows.length === 0) {
        return [];
      }

      const existingVariantIds = variantRows.map((variant) => variant.id);

      const activeVersions = await trx
        .select({
          variantId: productMasterVariants.variantId,
          masterId: productMasterVariants.masterId,
          versionId: productMasterVariants.versionId,
          salesStartDate: productMasterVersions.salesStartDate,
          salesEndDate: productMasterVersions.salesEndDate,
        })
        .from(productMasterVariants)
        .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
        .innerJoin(productMasters, eq(productMasterVariants.masterId, productMasters.id))
        .where(
          and(
            inArray(productMasterVariants.variantId, existingVariantIds),
            eq(productMasterVersions.status, 'active'),
            isNull(productMasterVersions.deletedAt),
            isNull(productMasters.deletedAt),
          ),
        )
        .orderBy(desc(productMasterVersions.updatedAt), desc(productMasterVersions.createdAt));

      const matchingRows = await trx
        .select({
          id: wmsTables.productMatchings.id,
          variantId: wmsTables.productMatchings.variantId,
          status: wmsTables.productMatchings.status,
          strategy: wmsTables.productMatchings.strategy,
          preStockSellable: wmsTables.productMatchings.preStockSellable,
          alwaysSellableZeroStock: wmsTables.productMatchings.alwaysSellableZeroStock,
        })
        .from(wmsTables.productMatchings)
        .where(inArray(wmsTables.productMatchings.variantId, existingVariantIds));

      const policyRows = await trx
        .select({
          variantId: wmsTables.salesVariantPolicies.variantId,
          availabilityOverride: wmsTables.salesVariantPolicies.availabilityOverride,
        })
        .from(wmsTables.salesVariantPolicies)
        .where(inArray(wmsTables.salesVariantPolicies.variantId, existingVariantIds));

      const matchingIds = matchingRows.map((matching) => matching.id);
      const linkRows =
        matchingIds.length > 0
          ? await trx
              .select({
                productMatchingId: wmsTables.productVariantSkuLinks.productMatchingId,
                skuId: wmsTables.productVariantSkuLinks.skuId,
                quantity: wmsTables.productVariantSkuLinks.quantity,
              })
              .from(wmsTables.productVariantSkuLinks)
              .where(inArray(wmsTables.productVariantSkuLinks.productMatchingId, matchingIds))
          : [];

      const skuIds = [...new Set(linkRows.map((link) => link.skuId))];
      const stockRows =
        skuIds.length > 0
          ? await trx
              .select({
                skuId: stockSummary.skuId,
                availableQuantity: sql<number>`GREATEST(COALESCE(SUM(${stockSummary.availableQty}), 0), 0)::int`,
              })
              .from(stockSummary)
              .where(inArray(stockSummary.skuId, skuIds))
              .groupBy(stockSummary.skuId)
          : [];

      const variantMap = new Map(variantRows.map((variant) => [variant.id, variant]));
      const activeVersionMap = new Map<string, (typeof activeVersions)[number]>();
      for (const activeVersion of activeVersions) {
        if (!activeVersionMap.has(activeVersion.variantId)) {
          activeVersionMap.set(activeVersion.variantId, activeVersion);
        }
      }

      const matchingMap = new Map(matchingRows.map((matching) => [matching.variantId, matching]));
      const policyMap = new Map(policyRows.map((policy) => [policy.variantId, policy]));
      const linksByMatchingId = new Map<string, typeof linkRows>();
      for (const link of linkRows) {
        const links = linksByMatchingId.get(link.productMatchingId) ?? [];
        links.push(link);
        linksByMatchingId.set(link.productMatchingId, links);
      }

      const availableBySkuId = new Map(stockRows.map((stock) => [stock.skuId, Number(stock.availableQuantity ?? 0)]));

      return uniqueVariantIds
        .map((variantId) => {
          const variant = variantMap.get(variantId);

          if (!variant) {
            return null;
          }

          const activeVersion = activeVersionMap.get(variantId);
          const matching = matchingMap.get(variantId);
          const policy = policyMap.get(variantId);
          const links = matching ? (linksByMatchingId.get(matching.id) ?? []) : [];

          const input: ProductSellableQuantityInput = {
            variantId,
            variantStatus: variant.status,
            activeVersion: activeVersion
              ? {
                  masterId: activeVersion.masterId,
                  versionId: activeVersion.versionId,
                  salesStartDate: activeVersion.salesStartDate,
                  salesEndDate: activeVersion.salesEndDate,
                }
              : null,
            matching: matching
              ? {
                  id: matching.id,
                  status: matching.status,
                  strategy: matching.strategy,
                  preStockSellable: matching.preStockSellable,
                  alwaysSellableZeroStock: matching.alwaysSellableZeroStock,
                }
              : null,
            availabilityOverride: policy?.availabilityOverride ?? null,
            components: links.map((link) => ({
              skuId: link.skuId,
              requiredQuantity: link.quantity,
              availableQuantity: availableBySkuId.get(link.skuId) ?? 0,
            })),
          };

          return calculateProductSellableQuantity(input);
        })
        .filter((projection): projection is ProductSellableQuantityResult => projection !== null);
    }, tx);
  }

  async recalculateAndPublishForVariant(
    variantId: string,
    tx?: unknown,
  ): Promise<{ projection: ProductSellableQuantityResult | null; published: boolean }> {
    return this.inTx(async (trx) => {
      await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${variantId}))`);

      let projection: ProductSellableQuantityResult;
      try {
        projection = await this.getByVariantId(variantId, trx);
      } catch (error) {
        if (error instanceof NotFoundException) {
          return { projection: null, published: false };
        }
        throw error;
      }

      const previous = await trx.query.productSellableQuantityProjections.findFirst({
        where: eq(wmsTables.productSellableQuantityProjections.variantId, variantId),
      });

      if (previous && !hasProductSellableQuantityProjectionChanged(projection, previous)) {
        return { projection, published: false };
      }

      const now = new Date();
      await trx
        .insert(wmsTables.productSellableQuantityProjections)
        .values({
          variantId: projection.variantId,
          masterId: projection.masterId,
          versionId: projection.versionId,
          matchingId: projection.matchingId,
          sellableQuantity: projection.sellableQuantity,
          stockBoundQuantity: projection.stockBoundQuantity,
          isSellable: projection.isSellable,
          reason: projection.reason,
          calculatedAt: projection.calculatedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: wmsTables.productSellableQuantityProjections.variantId,
          set: {
            masterId: projection.masterId,
            versionId: projection.versionId,
            matchingId: projection.matchingId,
            sellableQuantity: projection.sellableQuantity,
            stockBoundQuantity: projection.stockBoundQuantity,
            isSellable: projection.isSellable,
            reason: projection.reason,
            calculatedAt: projection.calculatedAt,
            updatedAt: now,
          },
        });

      await this.outbox.enqueue(
        {
          eventType: 'ProductSellableQuantityChanged',
          aggregateType: 'ProductSellableQuantity',
          aggregateId: projection.variantId,
          partitionKey: projection.variantId,
          payload: toProductSellableQuantityChangedPayload(projection),
        },
        trx as unknown as Parameters<OutboxService['enqueue']>[1],
      );

      return { projection, published: true };
    }, this.asTx(tx));
  }

  async recalculateAndPublishForVariants(
    variantIds: string[],
    tx?: unknown,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))].sort((a, b) => a.localeCompare(b));

    if (uniqueVariantIds.length === 0) {
      return [];
    }

    return this.inTx(async (trx) => {
      const results: Array<{ projection: ProductSellableQuantityResult | null; published: boolean }> = [];
      for (const variantId of uniqueVariantIds) {
        results.push(await this.recalculateAndPublishForVariant(variantId, trx));
      }
      return results;
    }, this.asTx(tx));
  }

  async recalculateAndPublishForVersion(
    versionId: string,
    tx?: unknown,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, versionId));

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, this.asTx(tx));
  }

  async recalculateAndPublishForSku(
    skuId: string,
    tx?: unknown,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({ variantId: wmsTables.productMatchings.variantId })
        .from(wmsTables.productVariantSkuLinks)
        .innerJoin(
          wmsTables.productMatchings,
          eq(wmsTables.productVariantSkuLinks.productMatchingId, wmsTables.productMatchings.id),
        )
        .where(eq(wmsTables.productVariantSkuLinks.skuId, skuId));

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, this.asTx(tx));
  }

  async recalculateAndPublishForMaster(
    masterId: string,
    tx?: unknown,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.masterId, masterId));

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, this.asTx(tx));
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'product-sellable-quantity-sales-period-refresh',
  })
  async refreshSalesPeriodProjectionsCron(): Promise<void> {
    if (this.isRefreshingSalesPeriodProjections) {
      return;
    }

    this.isRefreshingSalesPeriodProjections = true;

    try {
      const results = await this.refreshSalesPeriodProjections();
      const publishedCount = results.filter((result) => result.published).length;

      if (results.length > 0) {
        this.logger.log(`Refreshed sales-period sellable projections: ${publishedCount}/${results.length} published`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to refresh sales-period sellable projections',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRefreshingSalesPeriodProjections = false;
    }
  }

  async refreshSalesPeriodProjections(
    now = new Date(),
    limit = 500,
    tx?: unknown,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.inTx(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .innerJoin(productMasterVersions, eq(productMasterVariants.versionId, productMasterVersions.id))
        .innerJoin(productMasters, eq(productMasterVariants.masterId, productMasters.id))
        .leftJoin(
          wmsTables.productSellableQuantityProjections,
          eq(wmsTables.productSellableQuantityProjections.variantId, productMasterVariants.variantId),
        )
        .where(
          and(
            eq(productMasterVersions.status, 'active'),
            isNull(productMasterVersions.deletedAt),
            isNull(productMasters.deletedAt),
            or(
              and(
                isNotNull(productMasterVersions.salesStartDate),
                lte(productMasterVersions.salesStartDate, now),
                or(
                  isNull(wmsTables.productSellableQuantityProjections.calculatedAt),
                  sql`${wmsTables.productSellableQuantityProjections.calculatedAt} < ${productMasterVersions.salesStartDate}`,
                ),
              ),
              and(
                isNotNull(productMasterVersions.salesEndDate),
                lte(productMasterVersions.salesEndDate, now),
                or(
                  isNull(wmsTables.productSellableQuantityProjections.calculatedAt),
                  sql`${wmsTables.productSellableQuantityProjections.calculatedAt} < ${productMasterVersions.salesEndDate}`,
                ),
              ),
            ),
          ),
        )
        .orderBy(productMasterVariants.variantId)
        .limit(limit);

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, this.asTx(tx));
  }
}

export function toProductSellableQuantityChangedPayload(
  projection: ProductSellableQuantityResult,
): ProductSellableQuantityChangedPayload {
  return {
    variantId: projection.variantId,
    masterId: projection.masterId,
    versionId: projection.versionId,
    matchingId: projection.matchingId,
    sellableQuantity: projection.sellableQuantity,
    stockBoundQuantity: projection.stockBoundQuantity,
    isSellable: projection.isSellable,
    reason: projection.reason,
    availabilityOverride: projection.availabilityOverride,
    preStockSellable: projection.preStockSellable,
    calculatedAt: projection.calculatedAt.toISOString(),
  };
}

export function hasProductSellableQuantityProjectionChanged(
  current: ProductSellableQuantityResult,
  previous: {
    masterId: string | null;
    versionId: string | null;
    matchingId: string | null;
    sellableQuantity: number;
    stockBoundQuantity: number;
    isSellable: boolean;
    reason: string;
  },
): boolean {
  return (
    current.masterId !== previous.masterId ||
    current.versionId !== previous.versionId ||
    current.matchingId !== previous.matchingId ||
    current.sellableQuantity !== previous.sellableQuantity ||
    current.stockBoundQuantity !== previous.stockBoundQuantity ||
    current.isSellable !== previous.isSellable ||
    current.reason !== previous.reason
  );
}
