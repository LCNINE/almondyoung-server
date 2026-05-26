import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { TypedDatabase } from '@app/db/types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MergedSchema } from '../../../../platform/database/merged-schema';
import {
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
} from '../../../catalog/schema/catalog.schema';
import { stockSummary, wmsTables } from '../../schema/inventory.schema';
import {
  calculateProductSellableQuantity,
  ProductSellableQuantityInput,
  ProductSellableQuantityResult,
} from './product-sellable-quantity.calculator';

type ProductSellableQuantityDbTx = Parameters<Parameters<TypedDatabase<MergedSchema>['transaction']>[0]>[0];

@Injectable()
export class ProductSellableQuantityService {
  constructor(
    @InjectTypedDb<MergedSchema>()
    private readonly dbService: DbService<MergedSchema>,
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
}
