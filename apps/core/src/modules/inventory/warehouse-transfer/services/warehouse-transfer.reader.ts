import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, not, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';

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

  /**
   * draft 지시서에 실린 planned 합, SKU × 출발 창고 별. 보충 제안이 이동가능(비판매 ON_HAND)에서 뺀다 —
   * 초안은 원장을 안 움직이므로 원장만 보면 어제 낸 제안이 오늘 또 뜬다(#743 §7.2).
   * 선적된 지시서는 세지 않는다(이미 IN_TRANSFER). 판매 창고에서 나가는 초안(반품 이동)도 세지 않는다 —
   * 비판매 이동가능과 무관하다. 출발 창고별로 나누는 이유는 제안이 한 출발 창고만 고르기 때문이다(§7.2).
   */
  async findDraftPlannedBySku(
    tx: DbTx,
    skuIds: string[],
  ): Promise<Map<string, Array<{ fromWarehouseId: string; qty: number }>>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const lines = wmsTables.transferOrderLines;
      const orders = wmsTables.transferOrders;
      const rows = await trx
        .select({
          skuId: lines.skuId,
          fromWarehouseId: orders.fromWarehouseId,
          qty: sql<number>`SUM(${lines.plannedQty})::int`,
        })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.transferOrderId))
        .where(
          and(
            eq(orders.status, 'draft'),
            not(inSellableWarehouse(orders.fromWarehouseId)),
            inArray(lines.skuId, unique),
          ),
        )
        .groupBy(lines.skuId, orders.fromWarehouseId);
      const result = new Map<string, Array<{ fromWarehouseId: string; qty: number }>>();
      for (const row of rows) {
        const list = result.get(row.skuId) ?? [];
        list.push({ fromWarehouseId: row.fromWarehouseId, qty: Number(row.qty) });
        result.set(row.skuId, list);
      }
      return result;
    }, tx);
  }
}
