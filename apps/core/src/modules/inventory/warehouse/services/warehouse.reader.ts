import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, Warehouse } from '../../schema/inventory.schema';
import { WAREHOUSE_CONSTANTS, WarehouseType } from '../../core/constants/warehouse.constants';

@Injectable()
export class WarehouseReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async findAll(tx?: DbTx): Promise<Warehouse[]> {
    return this.inTx(
      async (trx) => trx.select().from(wmsTables.warehouses).orderBy(asc(wmsTables.warehouses.name)),
      tx,
    );
  }

  async findOne(id: string, tx?: DbTx): Promise<Warehouse> {
    const warehouse = await this.inTx(async (trx) => {
      const [row] = await trx.select().from(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).limit(1);
      return row;
    }, tx);

    if (!warehouse) {
      throw new NotFoundError(`창고를 찾을 수 없습니다: ${id}`);
    }

    return warehouse;
  }

  async findOneOrNull(id: string, tx?: DbTx): Promise<Warehouse | undefined> {
    return this.inTx(async (trx) => {
      const [row] = await trx.select().from(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).limit(1);
      return row;
    }, tx);
  }

  async isInUse(warehouseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId));

    return (row?.count ?? 0) > 0;
  }

  async getStockSummary(warehouseId: string) {
    const rows = await this.db
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        skuName: wmsTables.skus.name,
        skuCode: wmsTables.skus.code,
        totalQuantity: sql<number>`sum(${wmsTables.stockLedgers.qty})`,
        locationCount: sql<number>`count(distinct ${wmsTables.stockLedgers.locationId})`,
      })
      .from(wmsTables.stockLedgers)
      .innerJoin(wmsTables.skus, eq(wmsTables.stockLedgers.skuId, wmsTables.skus.id))
      .where(eq(wmsTables.stockLedgers.warehouseId, warehouseId))
      .groupBy(wmsTables.stockLedgers.skuId, wmsTables.skus.name, wmsTables.skus.code);

    return {
      warehouseId,
      summary: rows,
      totalSkus: rows.length,
      totalQuantity: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
      totalAvailable: rows.reduce((sum, item) => sum + item.totalQuantity, 0),
    };
  }

  getDefaultIdByType(type: WarehouseType): string {
    switch (type) {
      case 'domestic':
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
      case 'overseas':
        return WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id;
      default:
        return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
    }
  }

  getDefaultId(): string {
    return WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;
  }
}
