import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnyTx, DbService, InjectTypedDb, TxFor } from '@app/db';
import { and, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
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

type MergedTx = TxFor<MergedSchema>;

export type SoldOutState = 'none' | 'partial' | 'all';

// 목록의 품절 배지로 집계할 '실제 품절' 사유. 설정 미완(매칭없음 등)/판매기간/비활성은 제외.
const SOLD_OUT_REASONS = new Set(['MANUAL_OUT_OF_STOCK', 'INSUFFICIENT_COMPONENT_STOCK']);

@Injectable()
export class ProductSellableQuantityService {
  private readonly logger = new Logger(ProductSellableQuantityService.name);
  private isRefreshingSalesPeriodProjections = false;

  constructor(
    @InjectTypedDb<MergedSchema>()
    private readonly dbService: DbService<MergedSchema>,
    private readonly outbox: OutboxService,
  ) {}

  async getByVariantId(variantId: string, tx?: AnyTx): Promise<ProductSellableQuantityResult> {
    const [projection] = await this.getByVariantIds([variantId], tx);

    if (!projection) {
      throw new NotFoundException(`Variant not found: ${variantId}`);
    }

    return projection;
  }

  async getByVariantIds(
    variantIds: string[],
    tx?: AnyTx,
  ): Promise<ProductSellableQuantityResult[]> {
    const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))];

    if (uniqueVariantIds.length === 0) {
      return [];
    }

    return this.dbService.run(async (trx) => {
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
                // 창고별로 먼저 0 으로 자른 뒤 합산한다. 합산 후 자르면(GREATEST(SUM(..)))
                // 한 창고의 음수 available(과다 예약/이동중)이 다른 창고의 실재고를 상쇄해
                // 팔 수 있는 재고가 0 으로 사라진다.
                availableQuantity: sql<number>`COALESCE(SUM(GREATEST(${stockSummary.availableQty}, 0)), 0)::int`,
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
    }, tx as MergedTx | undefined);
  }

  /**
   * versionId별 품절 상태를 실시간 계산한다 (상품 목록 요약용).
   * 각 version 의 품목을 모아 getByVariantIds 로 한 번에 판정(품목 수 무관 상수 쿼리)한 뒤
   * version 기준으로 집계한다.
   * 품절성 사유(수동품절/재고부족)만 세고, 매칭없음 등 설정 미완은 제외한다.
   * - 'all': 모든 품목이 품절 (전체 품절)
   * - 'partial': 일부 품목만 품절 (부분 품절)
   * - 'none': 품절인 품목 없음 / 품목 없음
   * 판정 결과가 없는 version 은 Map 에 담기지 않으므로 호출부에서 'none' 으로 취급한다.
   */
  async getSoldOutStateByVersionIds(
    versionIds: string[],
    tx?: AnyTx,
  ): Promise<Map<string, SoldOutState>> {
    const uniqueVersionIds = [...new Set(versionIds.filter(Boolean))];
    const result = new Map<string, SoldOutState>();

    if (uniqueVersionIds.length === 0) {
      return result;
    }

    return this.dbService.run(async (trx) => {
      const variantRows = await trx
        .select({
          variantId: productMasterVariants.variantId,
          versionId: productMasterVariants.versionId,
        })
        .from(productMasterVariants)
        .where(inArray(productMasterVariants.versionId, uniqueVersionIds));

      if (variantRows.length === 0) {
        return result;
      }

      // 품목→목록 versionId 매핑 (getByVariantIds 가 내부적으로 active 버전을 다시 풀지만,
      // 목록에 뜬 version 기준으로 집계해야 하므로 여기서 잡은 versionId 를 쓴다)
      const versionIdByVariant = new Map(variantRows.map((row) => [row.variantId, row.versionId]));
      const projections = await this.getByVariantIds([...versionIdByVariant.keys()], trx);

      // 실제 '품절성' 사유만 품절로 집계한다. 매칭없음/판매기간아님/비활성 같은
      // '설정 미완/판매 안 함' 상태는 품절이 아니므로 제외한다
      // (예: 선판매 켰지만 매칭 전 → MATCHING_MISSING → 품절 아님).
      const agg = new Map<string, { total: number; soldOut: number }>();
      for (const projection of projections) {
        const versionId = versionIdByVariant.get(projection.variantId);
        if (!versionId) continue;
        const bucket = agg.get(versionId) ?? { total: 0, soldOut: 0 };
        bucket.total += 1;
        if (SOLD_OUT_REASONS.has(projection.reason)) bucket.soldOut += 1;
        agg.set(versionId, bucket);
      }

      for (const [versionId, { total, soldOut }] of agg) {
        result.set(versionId, soldOut === 0 ? 'none' : soldOut === total ? 'all' : 'partial');
      }

      return result;
    }, tx as MergedTx | undefined);
  }

  async recalculateAndPublishForVariant(
    variantId: string,
    tx?: AnyTx,
  ): Promise<{ projection: ProductSellableQuantityResult | null; published: boolean }> {
    return this.dbService.run(async (trx) => {
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
          topic: INVENTORY_STREAM.topic.topic,
          // 판매가능수량 변경은 variant 당 여러 번이 정당해 자연 멱등키가 없다 —
          // 호출마다 고유 키로 topicless 시절의 무중복 동작을 유지한다.
          idempotencyKey: `psq-changed:${projection.variantId}:${randomUUID()}`,
          eventType: 'ProductSellableQuantityChanged',
          aggregateType: 'ProductSellableQuantity',
          aggregateId: projection.variantId,
          partitionKey: projection.variantId,
          payload: toProductSellableQuantityChangedPayload(projection),
        },
        trx as unknown as Parameters<OutboxService['enqueue']>[1],
      );

      return { projection, published: true };
    }, tx as MergedTx | undefined);
  }

  async recalculateAndPublishForVariants(
    variantIds: string[],
    tx?: AnyTx,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    const uniqueVariantIds = [...new Set(variantIds.filter(Boolean))].sort((a, b) => a.localeCompare(b));

    if (uniqueVariantIds.length === 0) {
      return [];
    }

    return this.dbService.run(async (trx) => {
      const results: Array<{ projection: ProductSellableQuantityResult | null; published: boolean }> = [];
      for (const variantId of uniqueVariantIds) {
        results.push(await this.recalculateAndPublishForVariant(variantId, trx));
      }
      return results;
    }, tx as MergedTx | undefined);
  }

  async recalculateAndPublishForVersion(
    versionId: string,
    tx?: AnyTx,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.versionId, versionId));

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, tx as MergedTx | undefined);
  }

  async recalculateAndPublishForSku(
    skuId: string,
    tx?: AnyTx,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.dbService.run(async (trx) => {
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
    }, tx as MergedTx | undefined);
  }

  async recalculateAndPublishForMaster(
    masterId: string,
    tx?: AnyTx,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({ variantId: productMasterVariants.variantId })
        .from(productMasterVariants)
        .where(eq(productMasterVariants.masterId, masterId));

      return this.recalculateAndPublishForVariants(
        rows.map((row) => row.variantId),
        trx,
      );
    }, tx as MergedTx | undefined);
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
    tx?: AnyTx,
  ): Promise<Array<{ projection: ProductSellableQuantityResult | null; published: boolean }>> {
    return this.dbService.run(async (trx) => {
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
    }, tx as MergedTx | undefined);
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
