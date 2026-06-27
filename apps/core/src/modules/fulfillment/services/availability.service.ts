import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { eq, and, sum } from 'drizzle-orm';

@Injectable()
export class AvailabilityService {
  constructor(private readonly db: DbService<typeof wmsSchema>) {}

  async getAvailableQuantity(skuId: string, warehouseId: string, tx?: DbTx) {
    return this.db.run(async (trx) => {
      const [onHand] = await trx
        .select({ qty: sum(wmsTables.stockLedgers.qty) })
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, skuId),
            eq(wmsTables.stockLedgers.warehouseId, warehouseId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );

      const [reserved] = await trx
        .select({ qty: sum(wmsTables.stockReservations.quantity) })
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.skuId, skuId),
            eq(wmsTables.stockReservations.warehouseId, warehouseId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );

      const onHandQty = Number(onHand?.qty ?? 0);
      const reservedQty = Number(reserved?.qty ?? 0);
      return Math.max(0, onHandQty - reservedQty);
    }, tx);
  }
}
