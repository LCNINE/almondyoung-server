import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx, Warehouse } from '../../schema/inventory.schema';

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

  /**
   * "기본 창고" = 판매 창고. 재고가 실제로 있고 파는 곳이며, 이행 오더가 생겨야 할 곳이다.
   *
   * 예전에는 WAREHOUSE_CONSTANTS 의 하드코딩 UUID 를 그냥 반환했는데, 그 id 는 부팅이
   * 만든 껍데기라 실운영 창고(019d0001-…)와 갈라져 있었다 — 이행 오더가 재고 0·피킹
   * 전략 없는 창고로 생성되고 있었다.
   *
   * WarehouseManager.update 의 가드 두 개가 판매 창고를 "정확히 하나" 로 유지하므로
   * 모호하지 않다. 그래도 정렬을 거는 건 통합 픽스처가 직접 INSERT 라 그 불변식 밖이고,
   * 정렬이 없으면 어느 행이 오는지 실행 계획에 따라 갈려 스펙이 흔들리기 때문이다.
   */
  async getDefaultId(tx?: DbTx): Promise<string> {
    return this.dbService.run(async (trx) => {
      const [row] = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.isSellable, true))
        .orderBy(asc(wmsTables.warehouses.createdAt))
        .limit(1);

      if (!row) {
        throw new ConflictError('판매 창고가 없습니다. 창고 설정에서 판매 창고를 하나 지정하세요.');
      }
      return row.id;
    }, tx);
  }
}
