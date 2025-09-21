import { Injectable } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables } from '../../../../database/schemas/wms-schema';
type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DbService<typeof wmsTables>) {}

  async getAvailableQuantity(skuId: string, warehouseId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const row = await db.query.stockSummary.findFirst({
      where: (s, { and, eq }) => and(eq(s.skuId, skuId), eq(s.warehouseId, warehouseId)),
    });
    return row?.availableQty ?? 0;
  }
}


