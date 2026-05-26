import { Injectable } from '@nestjs/common';
import { and, eq, inArray, SQL, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { GetStockQueryDto } from '../dto/get-stock-query.dto';
import { CurrentStockDto } from '../dto/current-stock.dto';
import { SkuStockSummaryDto } from '../dto/sku-stock-summary.dto';
import { PaginatedResponseDto } from '../../shared/dto';

@Injectable()
export class StockProjectionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly eventStore: StockEventStore,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async getCurrentStock(query: GetStockQueryDto, tx?: DbTx): Promise<PaginatedResponseDto<CurrentStockDto>> {
    const { skuId, warehouseId, page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    return this.inTx(async (trx) => {
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

  async getTotalBySku(
    skuId: string,
    tx?: DbTx,
  ): Promise<{
    skuId: string;
    totalRealQuantity: number;
    totalReservedQuantity: number;
    totalAvailableQuantity: number;
  }> {
    const summaries = await this.inTx(
      async (trx) => trx.select().from(wmsSchema.stockSummary).where(eq(wmsSchema.stockSummary.skuId, skuId)),
      tx,
    );

    const total = summaries.reduce(
      (acc, summary) => ({
        totalRealQuantity: acc.totalRealQuantity + summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
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
    const summary = await this.inTx(async (trx) => {
      const [row] = await trx
        .select()
        .from(wmsSchema.stockSummary)
        .where(and(eq(wmsSchema.stockSummary.skuId, skuId), eq(wmsSchema.stockSummary.warehouseId, warehouseId)))
        .limit(1);
      return row;
    }, tx);

    const details = await this.inTx(
      async (trx) =>
        trx
          .select({
            locationId: wmsTables.stockLedgers.locationId,
            stockState: wmsTables.stockLedgers.stockState,
            quantity: wmsTables.stockLedgers.qty,
          })
          .from(wmsTables.stockLedgers)
          .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.warehouseId, warehouseId))),
      tx,
    );

    return {
      summary: summary
        ? {
            currentQuantity: summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
            availableQuantity: summary.availableQty,
            reservedQuantity: summary.reservedQty,
            inboundPendingQuantity: summary.inboundPendingQty,
            outboundPendingQuantity: summary.onOrderQty,
            movingQuantity: summary.inTransferQty,
            defectiveQuantity: summary.defectiveQty,
            returnPendingQuantity: summary.transferPendingQty,
            lastUpdated: summary.lastCalculatedAt,
          }
        : null,
      details,
    };
  }

  getHistory(skuId: string, warehouseId?: string, startDate?: string, endDate?: string) {
    return this.eventStore.getEventHistory(skuId, warehouseId, startDate, endDate);
  }

  async getSkuSummary(skuId: string, tx?: DbTx): Promise<SkuStockSummaryDto> {
    return this.inTx(async (trx) => {
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
        realQuantity: summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
        reservedQuantity: summary.reservedQty,
        availableQuantity: summary.availableQty,
      }));

      const totals = summaries.reduce(
        (acc, summary) => ({
          totalRealQuantity: acc.totalRealQuantity + summary.onHandQty + summary.defectiveQty + summary.inTransferQty,
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
