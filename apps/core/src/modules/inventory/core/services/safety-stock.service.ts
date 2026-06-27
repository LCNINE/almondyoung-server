import { Injectable, Inject } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { TypedDatabase, DbService } from '@app/db';
import { wmsTables, wmsSchema, wmsViews, DbTx } from '../../schema/inventory.schema';
import { eq, and, lt, sql } from 'drizzle-orm';

export interface SafetyStockWarning {
  skuId: string;
  skuName: string;
  skuCode: string;
  currentStock: number;
  safetyStock: number;
  shortfall: number;
  warehouseId: string;
}

@Injectable()
export class SafetyStockService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * Get all SKUs below safety stock threshold
   */
  async getBelowSafetyStock(warehouseId?: string, tx?: DbTx): Promise<SafetyStockWarning[]> {
    return this.dbService.run(async (tx) => {
      // Build query conditions
      const conditions = [sql`COALESCE(${wmsViews.stockSummary.onHandQty}, 0)::int < ${wmsTables.skus.safetyStock}`];

      if (warehouseId) {
        conditions.push(eq(wmsViews.stockSummary.warehouseId, warehouseId));
      }

      const query = tx
        .select({
          skuId: wmsTables.skus.id,
          skuName: wmsTables.skus.name,
          skuCode: wmsTables.skus.code,
          safetyStock: wmsTables.skus.safetyStock,
          currentStock: sql<number>`COALESCE(${wmsViews.stockSummary.onHandQty}, 0)::int`,
          warehouseId: wmsViews.stockSummary.warehouseId,
        })
        .from(wmsTables.skus)
        .leftJoin(wmsViews.stockSummary, eq(wmsTables.skus.id, wmsViews.stockSummary.skuId))
        .where(and(...conditions));

      const results = await query;

      return results.map((row) => ({
        skuId: row.skuId,
        skuName: row.skuName,
        skuCode: row.skuCode,
        currentStock: row.currentStock,
        safetyStock: row.safetyStock,
        shortfall: row.safetyStock - row.currentStock,
        warehouseId: row.warehouseId ?? '',
      }));
    }, tx);
  }

  /**
   * Check if specific SKU is below safety stock
   */
  async isBelowSafetyStock(skuId: string, warehouseId: string, tx?: DbTx): Promise<boolean> {
    return this.dbService.run(async (tx) => {
      const result = await tx
        .select({
          safetyStock: wmsTables.skus.safetyStock,
          currentStock: sql<number>`COALESCE(${wmsViews.stockSummary.onHandQty}, 0)::int`,
        })
        .from(wmsTables.skus)
        .leftJoin(
          wmsViews.stockSummary,
          and(eq(wmsTables.skus.id, wmsViews.stockSummary.skuId), eq(wmsViews.stockSummary.warehouseId, warehouseId)),
        )
        .where(eq(wmsTables.skus.id, skuId))
        .limit(1);

      if (!result[0]) return false;

      return result[0].currentStock < result[0].safetyStock;
    }, tx);
  }

  /**
   * Get safety stock status for a specific SKU across all warehouses
   */
  async getSafetyStockStatus(
    skuId: string,
    tx?: DbTx,
  ): Promise<{
    skuId: string;
    skuName: string;
    skuCode: string;
    safetyStock: number;
    warehouses: Array<{
      warehouseId: string;
      warehouseName: string;
      currentStock: number;
      isBelowSafety: boolean;
      shortfall: number;
    }>;
  } | null> {
    return this.dbService.run(async (tx) => {
      // Get SKU info
      const skuResult = await tx
        .select({
          id: wmsTables.skus.id,
          name: wmsTables.skus.name,
          code: wmsTables.skus.code,
          safetyStock: wmsTables.skus.safetyStock,
        })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, skuId))
        .limit(1);

      if (!skuResult[0]) return null;

      const sku = skuResult[0];

      // Get stock by warehouse
      const stockByWarehouse = await tx
        .select({
          warehouseId: wmsViews.stockSummary.warehouseId,
          warehouseName: wmsViews.stockSummary.warehouseName,
          currentStock: sql<number>`COALESCE(${wmsViews.stockSummary.onHandQty}, 0)::int`,
        })
        .from(wmsViews.stockSummary)
        .where(eq(wmsViews.stockSummary.skuId, skuId));

      return {
        skuId: sku.id,
        skuName: sku.name,
        skuCode: sku.code,
        safetyStock: sku.safetyStock,
        warehouses: stockByWarehouse.map((row) => ({
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName ?? '',
          currentStock: row.currentStock,
          isBelowSafety: row.currentStock < sku.safetyStock,
          shortfall: Math.max(0, sku.safetyStock - row.currentStock),
        })),
      };
    }, tx);
  }

}
