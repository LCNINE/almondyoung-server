import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService, TypedDatabase } from '@app/db';
import { sql, and, eq, gt } from 'drizzle-orm';
import { wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0];

export interface SkuLocationInfo {
  locationId: string;
  locationCode: string;
  warehouseId: string;
  qty: number;
  zone?: string;
  aisle?: string;
  bay?: string;
  level?: string;
}

@Injectable()
export class InventoryQueryService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getAvailableOnHand(filter: { skuId: string; warehouseId?: string; locationId?: string }, tx?: DbTx): Promise<number> {
    const db = tx ?? this.db;
    const where = and(
      eq(wmsTables.stockLedgers.skuId, filter.skuId),
      filter.warehouseId ? eq(wmsTables.stockLedgers.warehouseId, filter.warehouseId) : undefined,
      filter.locationId ? eq(wmsTables.stockLedgers.locationId, filter.locationId) : undefined,
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND')
    );
    const [row] = await db
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}),0)` })
      .from(wmsTables.stockLedgers)
      .where(where);
    return row?.qty ?? 0;
  }

  /**
   * 특정 SKU가 위치한 모든 위치와 수량 정보 조회
   * @param skuId SKU ID
   * @param warehouseId 창고 ID
   * @param tx 트랜잭션 (선택적)
   * @returns 위치별 재고 정보 배열
   */
  async getSkuLocations(skuId: string, warehouseId: string, tx?: DbTx): Promise<SkuLocationInfo[]> {
    const db = tx ?? this.db;

    const stockLedgers = await db.query.stockLedgers.findMany({
      where: and(
        eq(wmsTables.stockLedgers.skuId, skuId),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        gt(wmsTables.stockLedgers.qty, 0)
      )
    });

    // TODO: Join with locations table when relations are properly set up
    return stockLedgers.map(ledger => ({
      locationId: ledger.locationId,
      locationCode: `LOC-${ledger.locationId.slice(-8)}`, // Simple fallback until location relation is fixed
      warehouseId: ledger.warehouseId,
      qty: ledger.qty,
      zone: undefined, // Will be populated when location relation is available
      aisle: undefined,
      bay: undefined,
      level: undefined
    }));
  }
}


