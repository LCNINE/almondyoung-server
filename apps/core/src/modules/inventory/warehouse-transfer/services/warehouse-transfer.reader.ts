import { Injectable } from '@nestjs/common';
import { eq, gt, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';

export interface OutstandingTransfer {
  transferOrderId: string;
  transferOrderLineId: string;
  skuId: string;
  toWarehouseId: string;
  outstandingQty: number;
  eta: Date | null;
  shippedAt: Date | null;
}

@Injectable()
export class WarehouseTransferReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 떠났으나 아직 도착·분실 정산되지 않은 잔량. 체류 감시와 파이프라인 ③의 원천이다. */
  async findOutstanding(tx: DbTx): Promise<OutstandingTransfer[]> {
    return this.dbService.run(async (trx) => {
      const lines = wmsTables.transferOrderLines;
      const orders = wmsTables.transferOrders;
      // 잔량 식은 select 와 where 가 같아야 한다 — 한쪽만 바뀌면 0 잔량 행이 새어나온다.
      const outstandingQty = sql<number>`(${lines.shippedQty} - ${lines.receivedQty} - ${lines.lostQty})::int`;

      const rows = await trx
        .select({
          transferOrderId: lines.transferOrderId,
          transferOrderLineId: lines.id,
          skuId: lines.skuId,
          toWarehouseId: orders.toWarehouseId,
          eta: orders.eta,
          shippedAt: orders.shippedAt,
          outstandingQty,
        })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.transferOrderId))
        .where(gt(outstandingQty, 0));

      return rows.map((row) => ({ ...row, outstandingQty: Number(row.outstandingQty) }));
    }, tx);
  }
}
