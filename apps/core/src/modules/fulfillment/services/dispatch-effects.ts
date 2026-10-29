import { ConflictException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
  type FulfillmentProgressedPayload,
  type FulfillmentShippedPayload,
  type SalesOrderShipmentDispatchedPayload,
  type ShipmentEventOrder,
  type ShipmentShippedPayload,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  fulfillmentProgressedOutboxEvent,
  fulfillmentShippedV1OutboxEvent,
  shipmentShippedOutboxEvent,
} from '../events';
import type { CarrierCode } from '../waybill/carrier/carrier-gateway.interface';
import { UUID_PATTERN } from './sku-barcode-resolution';

/**
 * 발송 뒤 효과 — 수량(FOI shipped_qty)·FO 발송 시각·이벤트 넷. 상자 주인(창고/입점사)을 모른다:
 * 출처는 호출자가 `origin` 으로 넘기고 ShipmentShipped 에 그대로 펼친다.
 */
const TRUSTED_CHANNEL_DISPATCH_SALES_CHANNELS = new Set(['medusa', 'naver', 'coupang']);

type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect;

interface EventLineIdentity {
  shipmentLineId: string;
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  salesOrderId: string;
  salesOrderLineId: string;
  salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
  channelOrderId: string;
  channelOrderItemId: string;
  channelProductId: string | null;
  skuId: string;
  qty: number;
  fulfillmentOrderItemQty: number;
  fulfillmentOrderItemShippedQty: number;
  fulfillmentOrderItemCanceledQty: number;
}

/**
 * 교환 상자 줄(K8 PR11) — 판매 줄에 `exchange_return_line_id` 가 있다. Medusa 품목 id 는 정산 사실이 나중에 채우므로
 * (선발송이면 정산보다 먼저 나간다) 채널 품목 신원을 요구하지 않고, 채널 발송 이벤트 줄에도 싣지 않는다 — 원래 품목 id 로
 * 실으면 그 품목의 발송 수량을 두 번 센다. 고객 발송 알림과 v1 완료 투영의 주문 신원(판매주문·채널 주문 id)만 쓴다.
 */
interface ExchangeLineIdentity {
  fulfillmentOrderId: string;
  salesOrderId: string;
  salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
  channelOrderId: string;
}

/** 고객 발송 알림이 읽는 주문 신원 — 채널 발송 이벤트 줄이 없는(교환 줄만 실은) 상자도 알림은 간다 */
export type ShipmentNoticeOrder = Pick<
  ShipmentEventOrder,
  'salesOrderId' | 'salesChannel' | 'channelOrderId' | 'isPartial'
>;

export interface FulfillmentSummary {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
  fullyShipped: boolean;
  items: Array<{ id: string; skuId: string; shippedQty: number }>;
}

/**
 * 출고 완료 투영의 항목. 구성 변경(#1063)으로 대체된 qty 0 항목은 나간 것이 없어 뺀다 — 계약이 shippedQty 양수를 요구해
 * 그대로 실으면 출고 트랜잭션이 통째로 실패한다. 합계는 0 을 빼도 같다.
 */
export function shippedItemsForCompletion(
  items: ReadonlyArray<{ id: string; skuId: string; shippedQty: number }>,
): FulfillmentShippedPayload['shippedItems'] {
  return items
    .filter((item) => item.shippedQty > 0)
    .map((item) => ({ fulfillmentItemId: item.id, skuId: item.skuId, shippedQty: item.shippedQty }));
}

export interface DispatchEventDeps {
  shipments: PublisherFor<typeof SHIPMENT_STREAM>;
  fulfillmentsV2: PublisherFor<typeof FULFILLMENT_V2_STREAM>;
  fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>;
  coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>;
}

export interface DispatchedShipmentFacts {
  origin: { warehouseId: string; supplierId?: never } | { supplierId: string; warehouseId?: never };
  shipmentId: string;
  attemptId: string;
  attemptNo: number;
  dispatchedAt: Date;
  waybill: { id: string; carrier: CarrierCode; trackingNo: string };
  summaries: FulfillmentSummary[];
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 요약을 읽고 전량 발송된 FO 에 shipped_at 을 찍는다. 이미 찍힌 FO 는 그대로 둔다 — 다 나간 FO 에 교환 상자(K8 PR11)가
 * 더 나가 다시 전량 발송이 돼도 처음 다 나간 시각이 남는다(v1 완료 투영도 FO 당 한 번이다). 회수는 이 칸을 비운다.
 */
export async function markFullyShippedOrders(
  tx: DbTx,
  lines: ShipmentLineRow[],
  at: Date,
): Promise<FulfillmentSummary[]> {
  const summaries = await loadFulfillmentSummaries(tx, lines);
  for (const summary of summaries) {
    if (summary.fullyShipped) {
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ shippedAt: at, updatedAt: at })
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.id, summary.fulfillmentOrderId),
            isNull(wmsTables.fulfillmentOrders.shippedAt),
          ),
        );
    }
  }
  return summaries;
}

export async function incrementFulfillmentItems(tx: DbTx, lines: ShipmentLineRow[], now: Date): Promise<void> {
  for (const line of lines) {
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, line.fulfillmentOrderItemId))
      .limit(1);
    if (!item) throw conflict('SHIPMENT_FOI_MISSING', `FOI ${line.fulfillmentOrderItemId} disappeared`);
    if (item.shippedQty + item.canceledQty + line.qty > item.qty) {
      throw conflict('SHIPMENT_FOI_OVER_SHIPPED', `FOI ${item.id} cannot accept shipment line ${line.id}`);
    }
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: item.shippedQty + line.qty, updatedAt: now })
      .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
  }
}

export async function loadFulfillmentSummaries(tx: DbTx, lines: ShipmentLineRow[]): Promise<FulfillmentSummary[]> {
  const foiRows = await tx
    .select({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
    .from(wmsTables.fulfillmentOrderItems)
    .where(
      inArray(
        wmsTables.fulfillmentOrderItems.id,
        lines.map((line) => line.fulfillmentOrderItemId),
      ),
    );
  const fulfillmentOrderIds = [...new Set(foiRows.map((row) => row.fulfillmentOrderId))].sort();
  const summaries: FulfillmentSummary[] = [];
  for (const fulfillmentOrderId of fulfillmentOrderIds) {
    const [fo] = await tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
      .limit(1);
    if (!fo) throw conflict('SHIPMENT_FULFILLMENT_ORDER_MISSING', `FO ${fulfillmentOrderId} disappeared`);
    const items = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId))
      .orderBy(asc(wmsTables.fulfillmentOrderItems.id));
    const shippedQty = items.reduce((sum, item) => sum + item.shippedQty, 0);
    const canceledQty = items.reduce((sum, item) => sum + item.canceledQty, 0);
    const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
    const outstandingQty = totalQty - shippedQty - canceledQty;
    const fullyShipped = outstandingQty === 0 && canceledQty === 0;
    summaries.push({
      fulfillmentOrderId,
      salesOrderId: fo.salesOrderId,
      shippedQty,
      canceledQty,
      outstandingQty,
      fullyShipped,
      items: items.map((item) => ({ id: item.id, skuId: item.skuId, shippedQty: item.shippedQty })),
    });
  }
  return summaries;
}

async function loadEventLineIdentities(
  tx: DbTx,
  shipmentId: string,
): Promise<{ lines: EventLineIdentity[]; exchangeLines: ExchangeLineIdentity[] }> {
  const rows = await tx
    .select({
      shipmentLineId: wmsTables.shipmentLines.id,
      fulfillmentOrderItemId: wmsTables.fulfillmentOrderItems.id,
      fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
      salesOrderId: wmsTables.salesOrders.id,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      salesChannel: wmsTables.salesOrders.salesChannel,
      channelOrderId: wmsTables.salesOrders.channelOrderId,
      channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
      channelProductId: wmsTables.salesOrderLines.channelProductId,
      exchangeReturnLineId: wmsTables.salesOrderLines.exchangeReturnLineId,
      skuId: wmsTables.shipmentLines.skuId,
      qty: wmsTables.shipmentLines.qty,
      fulfillmentOrderItemQty: wmsTables.fulfillmentOrderItems.qty,
      fulfillmentOrderItemShippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
      fulfillmentOrderItemCanceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .leftJoin(
      wmsTables.salesOrderLines,
      sql`${wmsTables.salesOrderLines.id}::text = ${wmsTables.fulfillmentOrderItems.salesOrderLineId}`,
    )
    .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(wmsTables.fulfillmentOrders.id), asc(wmsTables.shipmentLines.id));
  // 교환 줄은 채널 품목 id 없이도 나간다(위 ExchangeLineIdentity) — 판매주문·채널 주문 신원은 그대로 요구한다
  const invalid = rows.find(
    (row) =>
      row.salesChannel !== null &&
      TRUSTED_CHANNEL_DISPATCH_SALES_CHANNELS.has(row.salesChannel) &&
      (!row.salesOrderId ||
        !row.salesOrderLineId ||
        !UUID_PATTERN.test(row.salesOrderLineId) ||
        (row.exchangeReturnLineId === null && !row.channelOrderItemId?.trim()) ||
        !row.channelOrderId?.trim()),
  );
  if (invalid) {
    throw conflict(
      'SHIPMENT_EVENT_IDENTITY_MISSING',
      `Shipment line ${invalid.shipmentLineId} has no trusted channel identity`,
    );
  }
  const identified = rows.filter(
    (row) =>
      row.salesOrderId !== null &&
      row.salesOrderLineId !== null &&
      UUID_PATTERN.test(row.salesOrderLineId) &&
      row.salesChannel !== null &&
      Boolean(row.channelOrderId?.trim()),
  );
  return {
    lines: identified.filter(
      (row) => row.exchangeReturnLineId === null && Boolean(row.channelOrderItemId?.trim()),
    ) as EventLineIdentity[],
    exchangeLines: identified
      .filter((row) => row.exchangeReturnLineId !== null)
      .map((row) => ({
        fulfillmentOrderId: row.fulfillmentOrderId,
        salesOrderId: row.salesOrderId!,
        salesChannel: row.salesChannel!,
        channelOrderId: row.channelOrderId!,
      })),
  };
}

export async function emitShipmentDispatched(
  deps: DispatchEventDeps,
  tx: DbTx,
  e: DispatchedShipmentFacts,
): Promise<void> {
  const { shipments, fulfillmentsV2, fulfillmentsV1, coreOrders } = deps;
  const { attemptId, attemptNo, dispatchedAt, summaries, waybill } = e;
  const carrier = waybill.carrier;
  const { lines, exchangeLines } = await loadEventLineIdentities(tx, e.shipmentId);
  const summaryByFo = new Map(summaries.map((summary) => [summary.fulfillmentOrderId, summary]));
  const orders: ShipmentEventOrder[] = [];
  for (const fulfillmentOrderId of [...new Set(lines.map((line) => line.fulfillmentOrderId))].sort()) {
    const orderLines = lines.filter((line) => line.fulfillmentOrderId === fulfillmentOrderId);
    const first = orderLines[0];
    const summary = summaryByFo.get(fulfillmentOrderId)!;
    orders.push({
      salesOrderId: first.salesOrderId,
      fulfillmentOrderId,
      salesChannel: first.salesChannel,
      channelOrderId: first.channelOrderId,
      isPartial: summary.outstandingQty > 0,
      lines: orderLines.map((line) => ({
        shipmentLineId: line.shipmentLineId,
        fulfillmentOrderItemId: line.fulfillmentOrderItemId,
        salesOrderLineId: line.salesOrderLineId,
        channelOrderItemId: line.channelOrderItemId,
        ...(line.channelProductId ? { channelProductId: line.channelProductId } : {}),
        skuId: line.skuId,
        qty: line.qty,
        isPartialQuantity:
          line.qty <
          line.fulfillmentOrderItemQty -
            (line.fulfillmentOrderItemShippedQty - line.qty) -
            line.fulfillmentOrderItemCanceledQty,
      })),
    });
  }
  const shipmentPayload: ShipmentShippedPayload = {
    shipmentId: e.shipmentId,
    dispatchAttemptId: attemptId,
    attemptNo,
    ...e.origin,
    dispatchedAt: dispatchedAt.toISOString(),
    invoice: { invoiceId: waybill.id, carrier, trackingNo: waybill.trackingNo },
    orders,
  };
  await shipments.enqueue(shipmentShippedOutboxEvent(shipmentPayload), tx);
  // 알림은 채널 발송 이벤트 줄과 별개로 상자가 실은 판매주문마다 하나 — 교환 줄만 실은 상자도 고객에게 알린다
  const noticeOrders: ShipmentNoticeOrder[] = [...orders];
  for (const exchange of exchangeLines) {
    if (noticeOrders.some((order) => order.salesOrderId === exchange.salesOrderId)) continue;
    noticeOrders.push({
      salesOrderId: exchange.salesOrderId,
      salesChannel: exchange.salesChannel,
      channelOrderId: exchange.channelOrderId,
      isPartial: (summaryByFo.get(exchange.fulfillmentOrderId)?.outstandingQty ?? 0) > 0,
    });
  }
  await enqueueCustomerShipmentNotices(
    coreOrders,
    tx,
    noticeOrders,
    attemptId,
    carrier,
    waybill.trackingNo,
    dispatchedAt,
  );

  for (const summary of summaries) {
    const progressed: FulfillmentProgressedPayload = {
      fulfillmentOrderId: summary.fulfillmentOrderId,
      salesOrderId: summary.salesOrderId,
      dispatchAttemptId: attemptId,
      progressedAt: dispatchedAt.toISOString(),
      shippedQty: summary.shippedQty,
      canceledQty: summary.canceledQty,
      outstandingQty: summary.outstandingQty,
    };
    await fulfillmentsV2.enqueue(fulfillmentProgressedOutboxEvent(progressed), tx);

    // v1 완료 투영은 FO 당 한 번(멱등 키 `${foId}:fully-shipped`) — 이미 다 나간 FO 에 교환 상자가 더 나가 다시 완료돼도
    // 아웃박스가 두 번째 행을 버린다. 교환 상자가 마지막으로 FO 를 끝낸 경우를 위해 교환 줄의 주문 신원도 쓴다
    const eventLine =
      lines.find((line) => line.fulfillmentOrderId === summary.fulfillmentOrderId) ??
      exchangeLines.find((line) => line.fulfillmentOrderId === summary.fulfillmentOrderId);
    if (summary.fullyShipped && summary.salesOrderId && eventLine) {
      const v1Payload: FulfillmentShippedPayload = {
        fulfillmentId: summary.fulfillmentOrderId,
        orderId: summary.salesOrderId,
        channelOrderId: eventLine.channelOrderId,
        trackingInfo: { carrier, trackingNumber: waybill.trackingNo },
        shippedAt: dispatchedAt.toISOString(),
        shippedItems: shippedItemsForCompletion(summary.items),
      };
      await fulfillmentsV1.enqueue(
        fulfillmentShippedV1OutboxEvent(v1Payload, { ...summary, salesOrderId: summary.salesOrderId }),
        tx,
      );
    }
  }
}

export async function enqueueCustomerShipmentNotices(
  coreOrders: DispatchEventDeps['coreOrders'],
  tx: DbTx,
  orders: ShipmentNoticeOrder[],
  attemptId: string,
  carrier: string,
  trackingNo: string,
  dispatchedAt: Date,
): Promise<void> {
  const medusaOrders = orders.filter((order) => order.salesChannel === 'medusa');
  if (medusaOrders.length === 0) return;
  const customers = await tx
    .select({
      id: wmsTables.salesOrders.id,
      displayOrderNo: wmsTables.salesOrders.displayOrderNo,
      customerId: wmsTables.salesOrders.customerId,
      customerEmail: wmsTables.salesOrders.customerEmail,
      customerName: wmsTables.salesOrders.customerName,
    })
    .from(wmsTables.salesOrders)
    .where(
      inArray(
        wmsTables.salesOrders.id,
        medusaOrders.map((order) => order.salesOrderId),
      ),
    );
  const customerByOrder = new Map(customers.map((row) => [row.id, row]));
  for (const order of medusaOrders) {
    const customer = customerByOrder.get(order.salesOrderId);
    if (!customer?.customerId || !customer.customerEmail) continue;
    await coreOrders.enqueue(
      {
        idempotencyKey: `so-shipment-dispatched:${attemptId}:${order.salesOrderId}`,
        eventType: 'SalesOrderShipmentDispatched',
        aggregateId: order.salesOrderId,
        partitionKey: order.salesOrderId,
        payload: {
          orderId: order.salesOrderId,
          channelOrderId: order.channelOrderId,
          ...(customer.displayOrderNo ? { displayOrderNo: customer.displayOrderNo } : {}),
          customerId: customer.customerId,
          customerEmail: customer.customerEmail,
          ...(customer.customerName ? { customerName: customer.customerName } : {}),
          dispatchAttemptId: attemptId,
          isPartial: order.isPartial,
          carrier,
          trackingNo,
          dispatchedAt: dispatchedAt.toISOString(),
        } satisfies SalesOrderShipmentDispatchedPayload,
      },
      tx,
    );
  }
}
