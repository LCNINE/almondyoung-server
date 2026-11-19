import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, SQL, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { GetStockSummaryListQueryDto, StockSummaryListItemDto } from '../dto/stock-summary-list.dto';
import { CurrentStockDto } from '../dto/current-stock.dto';
import { SkuStockSummaryDto } from '../dto/sku-stock-summary.dto';
import { PaginatedResponseDto } from '../../shared/dto';
import { LocationContentsDto } from '../dto/location-contents.dto';
import { readLocationStockAvailability } from '../../shared/availability/location-stock-availability';
import { physicalQuantity } from './physical-quantity';
import { GetStockSummaryByGroupQueryDto, StockSummaryGroupDto } from '../dto/stock-summary-by-group.dto';
import { groupStockSummaries } from './group-stock-summaries';
import {
  productImages,
  productMasterVariants,
  productMasterVersions,
  salesChannels,
} from '../../../catalog/schema/catalog.schema';
import { remainingUnshippedQuantity, unshippedDemandPredicate } from './unshipped-demand';
import { unshippedOrders } from './unshipped-orders';
import { UnshippedOrdersResponseDto } from '../dto/unshipped-orders.dto';

@Injectable()
export class StockProjectionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
  ) {}

  async getCurrentStock(query: GetStockQueryDto, tx?: DbTx): Promise<PaginatedResponseDto<CurrentStockDto>> {
    const { skuId, warehouseId, page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    return this.dbService.run(async (trx) => {
      const conditions: SQL[] = [eq(wmsSchema.stockSummary.warehouseId, warehouseId)];

      if (skuId) {
        conditions.push(eq(wmsSchema.stockSummary.skuId, skuId));
      }

      const summaries = await trx
        .select()
        .from(wmsSchema.stockSummary)
        .where(and(...conditions))
        .limit(limit)
        .offset(offset);

      const data = summaries.map((s) => ({
        skuId: s.skuId,
        skuName: s.skuName ?? '',
        warehouseId: s.warehouseId,
        warehouseName: s.warehouseName ?? '',
        onHandQty: s.onHandQty,
        defectiveQty: s.defectiveQty,
        inTransferQty: s.inTransferQty,
        returnedQty: s.returnedQty,
        reservedQty: s.reservedQty,
        availableQty: s.availableQty,
        inboundPendingQty: s.inboundPendingQty,
        projectedAvailableQty: s.projectedAvailableQty,
        lastCalculatedAt: s.lastCalculatedAt,
      }));

      const [countResult] = await trx
        .select({ count: sql<number>`count(*)` })
        .from(wmsSchema.stockSummary)
        .where(and(...conditions));

      return {
        data,
        total: Number(countResult?.count || 0),
        page,
        limit,
      };
    }, tx);
  }

  async listStockSummaries(
    query: GetStockSummaryListQueryDto,
    tx?: DbTx,
  ): Promise<PaginatedResponseDto<StockSummaryListItemDto>> {
    const { skuId, warehouseId, search, quantityState, page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    return this.dbService.run(async (trx) => {
      const v = wmsSchema.stockSummary;
      // view는 SKU × 창고 CROSS JOIN — 재고 움직임이 전혀 없는 조합은 목록에서 제외
      const conditions: SQL[] = [
        sql`(${v.onHandQty} <> 0 OR ${v.defectiveQty} <> 0 OR ${v.inTransferQty} <> 0 OR ${v.returnedQty} <> 0 OR ${v.reservedQty} <> 0 OR ${v.inboundPendingQty} <> 0 OR ${v.transferPendingQty} <> 0)`,
      ];
      if (skuId) {
        conditions.push(eq(v.skuId, skuId));
      }
      if (warehouseId) {
        conditions.push(eq(v.warehouseId, warehouseId));
      }
      if (search?.trim()) {
        const like = `%${search.trim()}%`;
        // 3소스(SKU 라벨/코드 + 활성 버전 상품명)를 union 해 매칭되는 sku_id로 뷰를 필터.
        conditions.push(sql`${v.skuId} IN (
          SELECT s.id FROM skus s WHERE s.name ILIKE ${like} OR s.code ILIKE ${like}
          UNION
          SELECT l.sku_id
          FROM product_master_versions pmv
          JOIN product_master_variants pmvar ON pmvar.version_id = pmv.id
          JOIN product_matchings pm ON pm.variant_id = pmvar.variant_id
          JOIN product_variant_sku_links l ON l.product_matching_id = pm.id
          WHERE pmv.name ILIKE ${like} AND pmv.status = 'active' AND pmv.deleted_at IS NULL
        )`);
      }
      if (quantityState === 'out_of_stock') {
        conditions.push(sql`${v.availableQty} <= 0`);
      }
      if (quantityState === 'reserved') {
        conditions.push(sql`${v.reservedQty} > 0`);
      }
      if (quantityState === 'inbound_pending') {
        conditions.push(sql`${v.inboundPendingQty} > 0`);
      }
      if (quantityState === 'outbound_pending') {
        conditions.push(sql`${v.onOrderQty} > 0`);
      }

      const rows = await trx
        .select()
        .from(v)
        .where(and(...conditions))
        .orderBy(v.skuName, v.warehouseName)
        .limit(limit)
        .offset(offset);

      const [countResult] = await trx
        .select({ count: sql<number>`count(*)` })
        .from(v)
        .where(and(...conditions));

      return {
        data: rows.map((s) => ({
          skuId: s.skuId,
          skuName: s.skuName ?? '',
          warehouseId: s.warehouseId,
          warehouseName: s.warehouseName ?? '',
          currentQuantity: physicalQuantity(s),
          availableQuantity: s.availableQty,
          reservedQuantity: s.reservedQty,
          inboundPendingQuantity: s.inboundPendingQty,
          outboundPendingQuantity: s.onOrderQty,
          lastUpdated: s.lastCalculatedAt,
        })),
        total: Number(countResult?.count || 0),
        page,
        limit,
      };
    }, tx);
  }

  async listStockSummariesByGroup(
    query: GetStockSummaryByGroupQueryDto,
    tx?: DbTx,
  ): Promise<PaginatedResponseDto<StockSummaryGroupDto>> {
    const { warehouseId, supplierId, search, queue, page = 1, limit = 20 } = query;

    return this.dbService.run(async (trx) => {
      const v = wmsSchema.stockSummary;
      const { skus, skuGroups, skuShelfPositions, skuSuppliers, replenishmentSkuOverrides } = wmsTables;
      const { fulfillmentOrders: fo, fulfillmentOrderItems: foi, productMatchings, productVariantSkuLinks } = wmsTables;
      const unshipped = trx.$with('unshipped_stock').as(
        trx
          .select({
            skuId: foi.skuId,
            warehouseId: fo.warehouseId,
            quantity: sql<number>`sum(${remainingUnshippedQuantity})`.mapWith(Number).as('unshipped_quantity'),
          })
          .from(foi)
          .innerJoin(fo, eq(fo.id, foi.fulfillmentOrderId))
          .where(and(unshippedDemandPredicate, warehouseId ? eq(fo.warehouseId, warehouseId) : undefined))
          .groupBy(foi.skuId, fo.warehouseId),
      );
      const unshippedQuantity = sql<number>`coalesce(${unshipped.quantity}, 0)`.mapWith(Number);
      const matches: (SQL | undefined)[] = [];

      if (supplierId) {
        matches.push(
          inArray(
            skus.id,
            trx.select({ skuId: skuSuppliers.skuId }).from(skuSuppliers).where(eq(skuSuppliers.supplierId, supplierId)),
          ),
        );
      }

      if (search?.trim()) {
        const like = `%${search.trim()}%`;
        const matchingProductSkus = trx
          .select({ skuId: productVariantSkuLinks.skuId })
          .from(productMasterVersions)
          .innerJoin(productMasterVariants, eq(productMasterVariants.versionId, productMasterVersions.id))
          .innerJoin(productMatchings, eq(productMatchings.variantId, productMasterVariants.variantId))
          .innerJoin(productVariantSkuLinks, eq(productVariantSkuLinks.productMatchingId, productMatchings.id))
          .where(
            and(
              ilike(productMasterVersions.name, like),
              eq(productMasterVersions.status, 'active'),
              isNull(productMasterVersions.deletedAt),
            ),
          );

        matches.push(or(ilike(skus.name, like), ilike(skus.code, like), inArray(skus.id, matchingProductSkus)));
      }

      const rows = trx.$with('group_stock_rows').as(
        trx
          .select({
            groupKey:
              sql<string>`case when ${skus.groupId} is null then 'sku:' || ${skus.id} else 'group:' || ${skus.groupId} end`.as(
                'group_key',
              ),
            groupId: skus.groupId,
            groupName: sql<string>`coalesce(${skuGroups.name}, ${skus.name})`.as('group_name'),
            groupCode: sql<string | null>`${skuGroups.code}`.as('group_code'),
            skuId: v.skuId,
            skuName: skus.name,
            skuCode: skus.code,
            warehouseId: v.warehouseId,
            warehouseName: sql<string>`coalesce(${v.warehouseName}, '')`.as('warehouse_name'),
            shelfPosition: skuShelfPositions.positionCode,
            onHandQty: v.onHandQty,
            defectiveQty: v.defectiveQty,
            inTransferQty: v.inTransferQty,
            returnedQty: v.returnedQty,
            availableQuantity: v.availableQty,
            inboundPendingQuantity: v.inboundPendingQty,
            unshippedQuantity: unshippedQuantity.as('unshipped_quantity'),
            safetyStock: replenishmentSkuOverrides.safetyStock,
            matchesFilters: sql<boolean>`${and(...matches) ?? sql`true`}`.as('matches_filters'),
          })
          .from(v)
          .innerJoin(skus, eq(skus.id, v.skuId))
          .leftJoin(skuGroups, eq(skuGroups.id, skus.groupId))
          .leftJoin(skuShelfPositions, eq(skuShelfPositions.skuId, v.skuId))
          .leftJoin(replenishmentSkuOverrides, eq(replenishmentSkuOverrides.skuId, v.skuId))
          .leftJoin(unshipped, and(eq(unshipped.skuId, v.skuId), eq(unshipped.warehouseId, v.warehouseId)))
          .where(
            and(
              warehouseId ? eq(v.warehouseId, warehouseId) : undefined,
              or(
                ne(v.onHandQty, 0),
                ne(v.defectiveQty, 0),
                ne(v.inTransferQty, 0),
                ne(v.returnedQty, 0),
                ne(v.reservedQty, 0),
                ne(v.inboundPendingQty, 0),
                ne(v.transferPendingQty, 0),
                gt(unshippedQuantity, 0),
              ),
            ),
          ),
      );
      let queueMatch: SQL | undefined;

      if (queue === 'unshipped') queueMatch = gt(rows.unshippedQuantity, 0);
      if (queue === 'below_safety_stock') {
        queueMatch = and(isNotNull(rows.safetyStock), lt(rows.availableQuantity, rows.safetyStock));
      }
      if (queue === 'out_of_stock') queueMatch = lte(rows.availableQuantity, 0);
      if (queue === 'inbound_pending') queueMatch = gt(rows.inboundPendingQuantity, 0);

      const groups = trx.$with('stock_groups').as(
        trx
          .select({
            groupKey: rows.groupKey,
            groupName: rows.groupName,
            // 불량·반품·이동 중 재고로는 못 보내므로 부족은 정상 재고(ON_HAND)와 비교한다.
            maxShortage: sql<number>`max(greatest(${rows.unshippedQuantity} - ${rows.onHandQty}, 0))`.as(
              'max_shortage',
            ),
            maxUnshipped: sql<number>`max(${rows.unshippedQuantity})`.as('max_unshipped'),
          })
          .from(rows)
          .groupBy(rows.groupKey, rows.groupName)
          // 검색·공급사·큐는 그룹을 고르고, 반환할 형제 SKU 행은 좁히지 않는다.
          .having(and(sql`bool_or(${rows.matchesFilters})`, queueMatch ? sql`bool_or(${queueMatch})` : undefined)),
      );
      const [countResult] = await trx.with(unshipped, rows, groups).select({ total: count() }).from(groups);
      // CTE 끼리 조인하면 drizzle 가 별칭 칸을 테이블 없이 써서("group_key" = "group_key") 모호해진다 — 두 번에 나눠 읽는다.
      const pageGroups = await trx
        .with(unshipped, rows, groups)
        .select({ groupKey: groups.groupKey })
        .from(groups)
        .orderBy(desc(groups.maxShortage), desc(groups.maxUnshipped), groups.groupName, groups.groupKey)
        .limit(limit)
        .offset((page - 1) * limit);
      const groupOrder = new Map(pageGroups.map((group, index) => [group.groupKey, index]));
      const pageSkuRows =
        groupOrder.size === 0
          ? []
          : (
              await trx
                .with(unshipped, rows)
                .select()
                .from(rows)
                .where(inArray(rows.groupKey, [...groupOrder.keys()]))
                .orderBy(rows.skuName, rows.skuCode, rows.warehouseName, rows.warehouseId)
            ).sort((a, b) => (groupOrder.get(a.groupKey) ?? 0) - (groupOrder.get(b.groupKey) ?? 0));

      const pageSkuIds = [...new Set(pageSkuRows.map((row) => row.skuId))];
      // 셀메이트 상품 사진 자리 — 스토어프론트와 같은 원천인 쇼핑몰 상품 대표 이미지. SKU 마다 매칭된 활성 상품 중 먼저 만든 것.
      const images =
        pageSkuIds.length === 0
          ? []
          : await trx
              .selectDistinctOn([productVariantSkuLinks.skuId], {
                skuId: productVariantSkuLinks.skuId,
                fileId: productImages.fileId,
              })
              .from(productVariantSkuLinks)
              .innerJoin(productMatchings, eq(productMatchings.id, productVariantSkuLinks.productMatchingId))
              .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productMatchings.variantId))
              .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
              .innerJoin(
                productImages,
                and(eq(productImages.versionId, productMasterVersions.id), eq(productImages.isPrimary, true)),
              )
              .where(
                and(
                  inArray(productVariantSkuLinks.skuId, pageSkuIds),
                  eq(productMasterVersions.status, 'active'),
                  isNull(productMasterVersions.deletedAt),
                ),
              )
              .orderBy(productVariantSkuLinks.skuId, productMasterVersions.createdAt, productMasterVersions.id);

      return {
        data: groupStockSummaries(pageSkuRows, new Map(images.map((image) => [image.skuId, image.fileId]))),
        total: countResult?.total ?? 0,
        page,
        limit,
      };
    }, tx);
  }

  async listUnshippedOrders(skuId: string, warehouseId: string, tx?: DbTx): Promise<UnshippedOrdersResponseDto> {
    return this.dbService.run(async (trx) => {
      const {
        fulfillmentOrderItems: foi,
        fulfillmentOrders: fo,
        salesOrders: so,
        shipmentLines,
        shipments,
      } = wmsTables;
      const rows = await trx
        .select({
          fulfillmentOrderItemId: foi.id,
          salesOrderId: so.id,
          orderNo: sql<string | null>`coalesce(${so.displayOrderNo}, ${so.channelOrderId})`,
          channelName: salesChannels.name,
          orderDate: so.orderDate,
          createdAt: fo.createdAt,
          customerName: so.customerName,
          remainingQuantity: remainingUnshippedQuantity,
          // 예약 정본은 상자 라인의 confirmed 예약이다 — FOI.reserved_qty 는 V2 출고에서 갱신되지 않는다.
          reservedQuantity: sql<number>`(
            select coalesce(sum(${wmsTables.stockReservations.quantity}), 0)
            from ${wmsTables.stockReservations}
            inner join ${shipmentLines} sl_r on sl_r.id = ${wmsTables.stockReservations.shipmentLineId}
            where sl_r.fulfillment_order_item_id = ${foi.id}
              and ${wmsTables.stockReservations.status} = 'confirmed'
          )`.mapWith(Number),
          shipmentStatus: shipments.status,
          shipmentQuantity: shipmentLines.qty,
          inspectedQuantity: shipmentLines.inspectedQty,
        })
        .from(foi)
        .innerJoin(fo, eq(fo.id, foi.fulfillmentOrderId))
        .leftJoin(so, eq(so.id, fo.salesOrderId))
        .leftJoin(salesChannels, eq(salesChannels.site, sql`${so.salesChannel}::text`))
        .leftJoin(shipmentLines, eq(shipmentLines.fulfillmentOrderItemId, foi.id))
        .leftJoin(shipments, eq(shipments.id, shipmentLines.shipmentId))
        .where(and(unshippedDemandPredicate, eq(foi.skuId, skuId), eq(fo.warehouseId, warehouseId)))
        .orderBy(sql`coalesce(${so.orderDate}, ${fo.createdAt})`, foi.id);

      return { items: unshippedOrders(rows, new Date()) };
    }, tx);
  }

  async getTotalBySku(
    skuId: string,
    tx?: DbTx,
  ): Promise<{
    skuId: string;
    totalRealQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
  }> {
    const summaries = await this.dbService.run(
      async (trx) => trx.select().from(wmsSchema.stockSummary).where(eq(wmsSchema.stockSummary.skuId, skuId)),
      tx,
    );

    const total = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity: acc.totalRealQuantity + physicalQuantity(summary),
        totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
        totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQty,
      }),
      { totalRealQuantity: 0, totalReservedQuantity: 0, totalAvailableQuantity: 0 },
    );

    return {
      skuId,
      ...total,
    };
  }

  async getBySkuAndWarehouse(skuId: string, warehouseId: string, tx?: DbTx) {
    const summary = await this.dbService.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsSchema.stockSummary)
        .where(and(eq(wmsSchema.stockSummary.skuId, skuId), eq(wmsSchema.stockSummary.warehouseId, warehouseId)))
        .limit(1);
      return row;
    }, tx);

    const details = await this.dbService.run(
      async (trx) =>
        trx
          .select({
            locationId: wmsTables.stockLedgers.locationId,
            locationCode: wmsTables.locations.code,
            locationName: wmsTables.locations.displayName,
            stockState: wmsTables.stockLedgers.stockState,
            quantity: wmsTables.stockLedgers.qty,
          })
          .from(wmsTables.stockLedgers)
          .leftJoin(wmsTables.locations, eq(wmsTables.stockLedgers.locationId, wmsTables.locations.id))
          .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.warehouseId, warehouseId)))
          .orderBy(sql`${wmsTables.locations.code} ASC NULLS LAST`, wmsTables.stockLedgers.stockState),
      tx,
    );

    return {
      summary: summary
        ? {
            currentQuantity: physicalQuantity(summary),
            availableQuantity: summary.availableQty,
            reservedQuantity: summary.reservedQty,
            inboundPendingQuantity: summary.inboundPendingQty,
            outboundPendingQuantity: summary.onOrderQty,
            movingQuantity: summary.inTransferQty,
            defectiveQuantity: summary.defectiveQty,
            returnedQuantity: summary.returnedQty,
            lastUpdated: summary.lastCalculatedAt,
          }
        : null,
      details,
    };
  }

  async getLocationContents(locationId: string, tx?: DbTx): Promise<LocationContentsDto> {
    return this.dbService.run(async (trx) => {
      const [location] = await trx
        .select({
          id: wmsTables.locations.id,
          code: wmsTables.locations.code,
          warehouseId: wmsTables.locations.warehouseId,
        })
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.id, locationId))
        .limit(1);

      if (!location) {
        throw new NotFoundError(`Location not found: ${locationId}`);
      }

      const items = await readLocationStockAvailability(trx, locationId, location.warehouseId);

      return {
        locationId: location.id,
        locationCode: location.code,
        warehouseId: location.warehouseId,
        items,
      };
    }, tx);
  }

  getHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    return this.eventStore.getEventHistory(skuId, warehouseId, startDate, endDate);
  }

  async getSkuSummary(skuId: string, tx?: DbTx): Promise<SkuStockSummaryDto> {
    return this.dbService.run(async (trx) => {
      const [sku] = await trx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, skuId)).limit(1);

      if (!sku) {
        throw new NotFoundError(`SKU with ID ${skuId} not found`);
      }

      const summaries = await trx.select().from(wmsSchema.stockSummary).where(eq(wmsSchema.stockSummary.skuId, skuId));

      const warehouseIds = summaries.map((s) => s.warehouseId);
      const warehouses = warehouseIds.length
        ? await trx.select().from(wmsTables.warehouses).where(inArray(wmsTables.warehouses.id, warehouseIds))
        : [];

      const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

      const warehouseStocks = summaries.map((summary) => ({
        warehouseId: summary.warehouseId,
        warehouseName: warehouseMap.get(summary.warehouseId)?.name || 'Unknown Warehouse',
        realQuantity: physicalQuantity(summary),
        reservedQuantity: summary.reservedQty,
        availableQuantity: summary.availableQty,
      }));

      const totals = summaries.reduce(
        (acc, summary) => ({
          totalRealQuantity: acc.totalRealQuantity + physicalQuantity(summary),
          totalReservedQuantity: acc.totalReservedQuantity + summary.reservedQty,
          totalAvailableQuantity: acc.totalAvailableQuantity + summary.availableQty,
        }),
        { totalRealQuantity: 0, totalReservedQuantity: 0, totalAvailableQuantity: 0 },
      );

      return {
        skuId: sku.id,
        skuName: sku.name,
        skuCode: sku.code,
        ...totals,
        warehouseStocks,
      };
    }, tx);
  }
}
