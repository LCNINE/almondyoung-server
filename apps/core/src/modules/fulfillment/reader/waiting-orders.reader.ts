import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { inboundPendingQuantitySql } from '../../inventory/shared/availability/inbound-origin-availability';
import { reservationQueueKeySql } from '../services/reservation-queue-key';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { DemandLine, StockBudget, waitingTotal } from './waiting-orders.calc';

export interface WaitingOrders {
  skuId: string;
  orders: number;
  qty: number;
}

/**
 * 상품별 «기다리는 주문» — 아직 작업을 시작하지 않은 상자 중 지금 집을 수 있는 재고로 나가지 못하는 몫.
 * 집을 수 있는 재고는 배치 시작의 배정과 같다(ON_HAND − 적치 전 입고 − 배치가 쥔 몫). 그래서 입고 뒤 예약이
 * 잡혀도 적치하기 전까지는 그대로 세고, 적치하면 줄어든다.
 */
@Injectable()
export class WaitingOrdersReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 기다리는 주문이 있는 상품만 돌려준다 */
  async forSkus(warehouseId: string, requestedSkuIds: readonly string[], tx?: DbTx): Promise<WaitingOrders[]> {
    const skuIds = [...new Set(requestedSkuIds)];
    if (skuIds.length === 0) return [];
    return this.dbService.run(async (trx) => {
      const demand = await this.demandLines(trx, warehouseId, skuIds);
      if (demand.length === 0) return [];

      const reserved = await this.confirmedReservations(trx, warehouseId, skuIds);
      const started = await this.startedQuantities(
        trx,
        demand.map((row) => row.lineId),
      );
      const notOurs = await loadSellmateShipmentIds(trx, [...new Set(demand.map((row) => row.shipmentId))]);
      const stock = await this.stockBudgets(trx, warehouseId, skuIds);

      const reservedByLine = new Map(reserved.map((row) => [row.shipmentLineId, Number(row.qty)]));
      for (const row of reserved) {
        const budget = stock.get(row.skuId);
        if (budget) budget.unreservedQty -= Number(row.qty);
      }

      const bySku = new Map<string, DemandLine[]>();
      for (const row of demand) {
        const lines = bySku.get(row.skuId) ?? [];
        lines.push({
          orderKey: row.salesOrderId ?? row.fulfillmentOrderId,
          qty: row.qty,
          reservedQty: reservedByLine.get(row.lineId) ?? 0,
          startedQty: started.get(row.lineId) ?? 0,
          counted: !notOurs.has(row.shipmentId),
        });
        bySku.set(row.skuId, lines);
      }

      return skuIds.flatMap((skuId) => {
        const total = waitingTotal(bySku.get(skuId) ?? [], stock.get(skuId) ?? { pickableQty: 0, unreservedQty: 0 });
        return total.qty > 0 ? [{ skuId, ...total }] : [];
      });
    }, tx);
  }

  /** 나갈 상자의 줄을 재고 대기 순번대로 */
  private demandLines(trx: DbTx, warehouseId: string, skuIds: string[]) {
    return trx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
      })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(
        and(
          eq(wmsTables.shipments.warehouseId, warehouseId),
          isNull(wmsTables.shipments.supplierId),
          inArray(wmsTables.shipments.status, ['draft', 'planned']),
          inArray(wmsTables.shipmentLines.skuId, skuIds),
        ),
      )
      .orderBy(reservationQueueKeySql(sql`shipment_lines`), asc(wmsTables.shipmentLines.id));
  }

  private confirmedReservations(trx: DbTx, warehouseId: string, skuIds: string[]) {
    return trx
      .select({
        skuId: wmsTables.stockReservations.skuId,
        shipmentLineId: wmsTables.stockReservations.shipmentLineId,
        qty: sql<number>`sum(${wmsTables.stockReservations.quantity})::int`,
      })
      .from(wmsTables.stockReservations)
      .where(
        and(
          inArray(wmsTables.stockReservations.skuId, skuIds),
          eq(wmsTables.stockReservations.warehouseId, warehouseId),
          eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      )
      .groupBy(wmsTables.stockReservations.skuId, wmsTables.stockReservations.shipmentLineId);
  }

  /** 시작한 배치가 줄에 배정한 수량 — 그만큼은 배치가 쥔 재고에 들어 있다 */
  private async startedQuantities(trx: DbTx, lineIds: string[]): Promise<Map<string, number>> {
    const rows = await trx
      .select({
        lineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        qty: sql<number>`sum(${wmsTables.pickingSourceAllocations.qty})::int`,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .where(
        and(
          inArray(wmsTables.pickingSourceAllocations.shipmentLineId, lineIds),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['completed', 'excluded']),
        ),
      )
      .groupBy(wmsTables.pickingSourceAllocations.shipmentLineId);
    return new Map(rows.map((row) => [row.lineId, Number(row.qty)]));
  }

  /** 확정 예약은 아직 빼지 않은 값이다 */
  private async stockBudgets(trx: DbTx, warehouseId: string, skuIds: string[]): Promise<Map<string, StockBudget>> {
    const onHand = await trx
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        qty: sql<number>`sum(${wmsTables.stockLedgers.qty})::int`,
      })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          inArray(wmsTables.stockLedgers.skuId, skuIds),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .groupBy(wmsTables.stockLedgers.skuId);
    const controlled = await trx
      .select({
        skuId: wmsTables.batchInventorySessionBalances.skuId,
        qty: sql<number>`sum(${wmsTables.batchInventorySessionBalances.qty})::int`,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.batchInventorySessions,
        eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
      )
      .innerJoin(
        wmsTables.locations,
        eq(wmsTables.locations.id, wmsTables.batchInventorySessionBalances.sourceLocationId),
      )
      .where(
        and(
          inArray(wmsTables.batchInventorySessionBalances.skuId, skuIds),
          eq(wmsTables.locations.warehouseId, warehouseId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .groupBy(wmsTables.batchInventorySessionBalances.skuId);
    const skuList = sql.join(
      skuIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const inbound = await trx.execute<{ sku_id: string; qty: number }>(sql`
      SELECT irl.sku_id, SUM(${inboundPendingQuantitySql})::int AS qty
        FROM inbound_receipt_lines irl
        JOIN inbound_receipts ir ON ir.id = irl.receipt_id
        JOIN locations origin ON origin.id = irl.origin_location_id
       WHERE ir.status = 'posted'
         AND ir.warehouse_id = ${warehouseId}
         AND origin.warehouse_id = ir.warehouse_id
         AND origin.is_system = true
         AND irl.sku_id IN (${skuList})
       GROUP BY irl.sku_id
    `);

    const budgets = new Map<string, StockBudget>();
    for (const row of onHand) budgets.set(row.skuId, { pickableQty: Number(row.qty), unreservedQty: Number(row.qty) });
    const unpickable = (skuId: string, qty: number) => {
      const budget = budgets.get(skuId);
      if (budget) budget.pickableQty -= qty;
    };
    for (const row of controlled) unpickable(row.skuId, Number(row.qty));
    for (const row of inbound) unpickable(row.sku_id, Number(row.qty));
    return budgets;
  }
}
