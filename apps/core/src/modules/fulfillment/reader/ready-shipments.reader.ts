import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { classifyPreparation } from '../outbound-preparation/outbound-preparation-classify';
import { OutboundPreparationReader } from '../outbound-preparation/outbound-preparation.reader';
import { loadUntrustedLineSkus } from '../outbound-preparation/needs-info';
import { loadShipmentLines, OptionLine } from '../services/consolidation-shipment-reads';
import { isRecipientComplete } from '../services/recipient-completeness';
import { reservationQueueOrderSql } from '../services/reservation-queue-key';
import { loadSellmateShipmentIds } from '../services/sellmate-handed-over-shipments';
import { maskName, readRecipientName } from './recipient-snapshot';
import { judgeReadiness, Readiness, ReadyBoxInput } from './ready-shipments.calc';
import { loadSkuStockBudgets } from './sku-stock-budget';

export interface ReadyShipment {
  shipmentId: string;
  status: 'draft' | 'planned';
  orderNos: string[];
  recipientMasked: string;
  skuCount: number;
  totalQty: number;
  readiness: Readiness;
}

export interface ReadyShipments {
  items: ReadyShipment[];
  /** 기준 상품 줄은 이번 입고로 다 찼는데 다른 상품이 모자라 빠진 상자 수 */
  waitingOnOtherSkus: number;
}

// 없는 줄로 본다 — uuid 꼴이 아니면 조회가 던진다
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 이번 입고로 다 갖춰진 상자(#1533). 받은 입고 줄의 상품마다 그 입고 시각 이후에 만들거나 늘린 확정 예약이 있고, 모든 줄이
 * 확정 예약으로 다 찼고, 출고 준비가 계획을 막지 않는 상자다. 판정은 대기 순번대로 상품 재고를 나눠 쓰며 한다.
 */
@Injectable()
export class ReadyShipmentsReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly preparation: OutboundPreparationReader,
  ) {}

  forReceiptLines(warehouseId: string, receiptLineIds: readonly string[], tx?: DbTx): Promise<ReadyShipments> {
    const lineIds = [...new Set(receiptLineIds)].filter((id) => UUID.test(id));
    const empty: ReadyShipments = { items: [], waitingOnOtherSkus: 0 };
    if (lineIds.length === 0) return Promise.resolve(empty);

    return this.dbService.run(async (trx) => {
      const since = await this.arrivalTimes(trx, warehouseId, lineIds);
      if (since.size === 0) return empty;

      const candidateIds = await this.reservedSinceArrival(trx, warehouseId, since);
      const sellmate = await loadSellmateShipmentIds(trx, candidateIds);
      const active = await this.activeShipmentIds(trx, candidateIds);
      const ids = candidateIds.filter((id) => !sellmate.has(id) && !active.has(id));
      if (ids.length === 0) return empty;

      const shipments = await trx
        .select({
          id: wmsTables.shipments.id,
          status: wmsTables.shipments.status,
          recipientSnapshot: wmsTables.shipments.recipientSnapshot,
        })
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, ids));
      const lines = groupBy(await loadShipmentLines(trx, ids), (line) => line.shipmentId);
      const quantities = await this.preparation.lineQuantities(ids, trx);
      const untrusted = await loadUntrustedLineSkus(trx, ids);

      let waitingOnOtherSkus = 0;
      const judged = new Map<string, { status: 'draft' | 'planned'; recipientSnapshot: unknown; orderNos: string[] }>();
      for (const shipment of shipments) {
        if (shipment.status !== 'draft' && shipment.status !== 'planned') continue;
        const shipmentQuantities = quantities.get(shipment.id) ?? [];
        const shipmentLines = lines.get(shipment.id) ?? [];
        // 합배송 후보는 보지 않는다 — 재고를 기다린 상자라 그대로 낸다(사용자 결정 2026-11-25)
        const bucket = classifyPreparation({
          status: shipment.status,
          hasActiveWorkItem: false,
          lines: shipmentQuantities,
          profileIds: shipmentLines.map((line) => line.skuProfileId),
          recipientComplete: isRecipientComplete(shipment.recipientSnapshot),
          externalLinesTrusted: !untrusted.has(shipment.id),
          consolidationPeerLines: [],
        });
        const isFull = (line: { qty: number; confirmedQty: number }) => line.confirmedQty >= line.qty;

        if (bucket === 'partial' || bucket === 'unavailable') {
          const base = shipmentQuantities.filter((line) => since.has(line.skuId));
          if (base.length > 0 && base.every(isFull)) waitingOnOtherSkus++;
          continue;
        }
        // planned 는 분류가 수량을 보지 않는다 — 다 찼는지는 여기서 본다
        if ((bucket !== 'ready' && bucket !== 'resume') || shipmentQuantities.length === 0) continue;
        if (!shipmentQuantities.every(isFull)) continue;

        const orderNos = [
          ...new Set(shipmentLines.flatMap((line) => line.displayOrderNo ?? line.channelOrderId ?? [])),
        ].sort();
        // 창고앱이 주문번호로 합류 후보를 찾는다
        if (orderNos.length === 0) continue;
        judged.set(shipment.id, {
          status: shipment.status,
          recipientSnapshot: shipment.recipientSnapshot,
          orderNos,
        });
      }
      if (judged.size === 0) return { items: [], waitingOnOtherSkus };

      const queue = await this.queueOrder(trx, [...judged.keys()]);
      const boxes: ReadyBoxInput[] = queue.map((shipmentId) => ({
        shipmentId,
        lines: (quantities.get(shipmentId) ?? []).map((line) => ({ skuId: line.skuId, qty: line.qty })),
      }));
      const budgets = await loadSkuStockBudgets(
        trx,
        warehouseId,
        boxes.flatMap((box) => box.lines.map((line) => line.skuId)),
      );
      const readiness = judgeReadiness(boxes, budgets);

      const items = boxes.flatMap((box): ReadyShipment[] => {
        const result = readiness.get(box.shipmentId);
        const shipment = judged.get(box.shipmentId);
        if (!result || !shipment) return [];
        return [
          {
            shipmentId: box.shipmentId,
            status: shipment.status,
            orderNos: shipment.orderNos,
            recipientMasked: maskName(readRecipientName(shipment.recipientSnapshot)),
            skuCount: new Set(box.lines.map((line) => line.skuId)).size,
            totalQty: box.lines.reduce((total, line) => total + line.qty, 0),
            readiness: result,
          },
        ];
      });
      return { items, waitingOnOtherSkus };
    }, tx);
  }

  /** 상품마다 이번 입고 시각 — 이 창고 posted 회차의 받은 줄 중 가장 이른 created_at */
  private async arrivalTimes(trx: DbTx, warehouseId: string, lineIds: string[]): Promise<Map<string, string>> {
    const rows = await trx
      .select({
        skuId: wmsTables.inboundReceiptLines.skuId,
        // 문자열로 받아 그대로 되넘긴다 — timestamptz 텍스트는 마이크로초까지 그대로다
        since: sql<string>`min(${wmsTables.inboundReceiptLines.createdAt})::text`,
      })
      .from(wmsTables.inboundReceiptLines)
      .innerJoin(wmsTables.inboundReceipts, eq(wmsTables.inboundReceipts.id, wmsTables.inboundReceiptLines.receiptId))
      .where(
        and(
          inArray(wmsTables.inboundReceiptLines.id, lineIds),
          eq(wmsTables.inboundReceipts.status, 'posted'),
          eq(wmsTables.inboundReceipts.warehouseId, warehouseId),
        ),
      )
      .groupBy(wmsTables.inboundReceiptLines.skuId);
    return new Map(rows.map((row) => [row.skuId, row.since]));
  }

  /**
   * 기준 상품 줄에 그 상품의 입고 시각 이후 만들거나 늘린 확정 예약이 있는 상자.
   * `reservePartial` 은 있던 예약 행을 제자리에서 늘리고 updated_at 만 바꾼다 — created_at 으로 보면 그 상자가 빠진다.
   */
  private async reservedSinceArrival(trx: DbTx, warehouseId: string, since: Map<string, string>): Promise<string[]> {
    const base = sql.join(
      [...since].map(([skuId, at]) => sql`(${skuId}::uuid, ${at}::timestamptz)`),
      sql`, `,
    );
    const rows = await trx.execute<{ id: string }>(sql`
      SELECT DISTINCT s.id
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN (VALUES ${base}) AS base(sku_id, since) ON base.sku_id = sl.sku_id
        JOIN stock_reservations r
          ON r.target_type = 'SHIPMENT_LINE'
         AND r.target_id = sl.id
         AND r.status = 'confirmed'
         AND r.updated_at >= base.since
         -- 줄과 같은 상품·창고 — stock_reservations_sku_warehouse_idx 를 타게
         AND r.sku_id = base.sku_id
         AND r.warehouse_id = s.warehouse_id
       WHERE s.warehouse_id = ${warehouseId}
         AND s.supplier_id IS NULL
         AND s.status IN ('draft', 'planned')
    `);
    return [...rows].map((row) => row.id);
  }

  private async activeShipmentIds(trx: DbTx, shipmentIds: string[]): Promise<Set<string>> {
    if (shipmentIds.length === 0) return new Set();
    const rows = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['excluded', 'completed']),
        ),
      );
    return new Set(rows.map((row) => row.shipmentId));
  }

  /** 상자를 재고 대기 순번대로 — 줄이 처음 나온 순서 */
  private async queueOrder(trx: DbTx, shipmentIds: string[]): Promise<string[]> {
    const rows = await trx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
      .orderBy(reservationQueueOrderSql(sql`shipment_lines`, sql`fulfillment_orders`), asc(wmsTables.shipmentLines.id));
    return [...new Set(rows.map((row) => row.shipmentId))];
  }
}

function groupBy(lines: readonly OptionLine[], keyOf: (line: OptionLine) => string): Map<string, OptionLine[]> {
  const groups = new Map<string, OptionLine[]>();
  for (const line of lines) {
    const key = keyOf(line);
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  return groups;
}
