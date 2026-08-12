import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';

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
      // execute() 원시 결과 타이핑 — warehouse-availability.ts 와 동일한 문서화된 캐스트.
      const rows = (await trx.execute(sql`
        SELECT tol.transfer_order_id, tol.id AS line_id, tol.sku_id,
               tord.to_warehouse_id, tord.eta, tord.shipped_at,
               (tol.shipped_qty - tol.received_qty - tol.lost_qty) AS outstanding
          FROM transfer_order_lines tol
          JOIN transfer_orders tord ON tord.id = tol.transfer_order_id
         WHERE (tol.shipped_qty - tol.received_qty - tol.lost_qty) > 0
      `)) as unknown as Array<{
        transfer_order_id: string;
        line_id: string;
        sku_id: string;
        to_warehouse_id: string;
        eta: Date | null;
        shipped_at: Date | null;
        outstanding: number | string;
      }>;

      return rows.map((row) => ({
        transferOrderId: row.transfer_order_id,
        transferOrderLineId: row.line_id,
        skuId: row.sku_id,
        toWarehouseId: row.to_warehouse_id,
        outstandingQty: Number(row.outstanding),
        eta: row.eta,
        shippedAt: row.shipped_at,
      }));
    }, tx);
  }
}
