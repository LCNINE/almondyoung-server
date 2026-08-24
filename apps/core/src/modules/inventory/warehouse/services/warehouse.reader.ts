import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
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

  async findAll(tx?: DbTx): Promise<Warehouse[]> {
    return this.dbService.run(
      async (trx) => trx.select().from(wmsTables.warehouses).orderBy(asc(wmsTables.warehouses.name)),
      tx,
    );
  }

  async findOne(id: string, tx?: DbTx): Promise<Warehouse> {
    const warehouse = await this.dbService.run(async (trx) => {
      const [row] = await trx.select().from(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).limit(1);
      return row;
    }, tx);

    if (!warehouse) {
      throw new NotFoundError(`창고를 찾을 수 없습니다: ${id}`);
    }

    return warehouse;
  }

  async findOneOrNull(id: string, tx?: DbTx): Promise<Warehouse | undefined> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx.select().from(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, id)).limit(1);
      return row;
    }, tx);
  }

  /**
   * 이 창고를 뺀 나머지 판매 창고 수. update 가드가 "판매 창고를 0 개로 만드는 수정"을
   * 판정하는 입력이며, 반드시 가드와 같은 트랜잭션에서 읽어야 한다 — 따로 읽으면 동시
   * 수정 두 건이 각자 "하나는 남는다"를 보고 둘 다 통과한다.
   */
  async countSellableExcluding(id: string, tx?: DbTx): Promise<number> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.warehouses)
        .where(and(eq(wmsTables.warehouses.isSellable, true), ne(wmsTables.warehouses.id, id)));

      return row?.count ?? 0;
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
