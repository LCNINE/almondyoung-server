import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService, TypedDatabase } from '@app/db';
import { sql, and, eq } from 'drizzle-orm';
import { wmsTables } from '../../../database/schemas/wms-schema';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class InventoryQueryService {
  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
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
}


