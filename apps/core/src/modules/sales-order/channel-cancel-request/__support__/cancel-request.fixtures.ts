import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
} from '@packages/event-contracts/streams';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { SalesOrdersService } from '../../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../../services/sales-order-amendments.service';
import { ChannelOrderChangeManager } from '../../channel-order-change/channel-order-change.manager';
import { ChannelOrderChangeReader } from '../../channel-order-change/channel-order-change.reader';
import { ChannelCancelSettler } from '../channel-cancel-settler';
import { ChannelCancelRequestManager } from '../channel-cancel-request.manager';
import { ChannelCancelRequestReader } from '../channel-cancel-request.reader';
import { ChannelCancelRequestService } from '../channel-cancel-request.service';
import { OrderCancellation } from '../../order-cancellation/order-cancellation';
import { OrderCancellationReader } from '../../order-cancellation/order-cancellation.reader';
import { PrintOrderReader } from '../../../print-order/services/print-order.reader';

export const ADDRESS = {
  recipientName: '김',
  phone: '010-1',
  postalCode: '12345',
  roadAddress: '서울',
  detailAddress: '101',
};

/** 판매주문(채널 라인 2개 — 수량 2·1) → 선택적으로 FO(→ draft 박스). channel-order-change 스펙의 seedOrder 와 같은 모양. */
export async function seedChannelOrder(
  tx: DbTx,
  w: { logistics: ReturnType<typeof wireLogistics> },
  opts: { withFo: boolean; salesChannel?: 'medusa' | 'naver' | 'coupang' | '3pl'; noChannelItemIds?: boolean },
) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const lines = [
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 2 },
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 1 },
  ];
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `ext-${randomUUID().slice(0, 8)}`,
      salesChannel: opts.salesChannel ?? 'medusa',
      status: 'confirmed',
      shippingAddress: ADDRESS,
      orderDate: new Date(),
    })
    .returning();
  const lineIds: string[] = [];
  for (const line of lines) {
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [row] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId,
        productName: 'IT',
        quantity: line.qty,
        unitPrice: 1000,
        channelOrderItemId: opts.noChannelItemIds ? null : line.item,
        channelProductId: `cp-${line.item}`,
      })
      .returning();
    lineIds.push(row.id);
  }
  if (opts.withFo) await w.logistics.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
  return { salesOrderId: so.id, externalOrderId: so.channelOrderId, lines, lineIds, warehouseId };
}

export type SeededOrder = Awaited<ReturnType<typeof seedChannelOrder>>;

/** 수집된 변경. 기본은 «아무것도 안 바뀜». */
export function modifiedPayload(
  seed: SeededOrder,
  over: {
    quantities?: number[];
    cancelRequests?: OrderModifiedPayload['snapshot']['cancelRequests'];
    address?: typeof ADDRESS;
    orderCancelled?: boolean;
  } = {},
): OrderModifiedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'medusa',
    externalOrderId: seed.externalOrderId,
    modifiedAt: new Date().toISOString(),
    snapshot: {
      shippingAddress: over.address ?? ADDRESS,
      lines: seed.lines.map((line, i) => ({
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
        quantity: over.quantities?.[i] ?? line.qty,
        unitPrice: 1000,
        cancelled: false,
      })),
      ...(over.cancelRequests ? { cancelRequests: over.cancelRequests } : {}),
      ...(over.orderCancelled ? { orderCancelled: true as const } : {}),
    },
  };
}

/** 줄의 출고 수량을 찍는다(31번·남은 몫 0 시나리오). FOI 비율 1 이라 판매 수량 = 물리 수량. */
export async function markLineShipped(tx: DbTx, salesOrderLineId: string, shippedQty: number): Promise<void> {
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty })
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId));
}

/**
 * 줄 «전체»가 출고된 모양 — 출고 수량을 다 찍고, 그 줄의 활성 박스 라인을 출고된 박스로 옮기고 예약을 푼다.
 * markLineShipped 는 수량만 찍는 지름길이라 판정(planCancellation)까지만 맞다. 요청이 물리 취소까지 하면(PR 5)
 * 같은 주문의 출고 불변식 검사(ACTIVE_LINE_QUANTITY)를 지나야 하므로, 다른 줄을 실제로 취소하는 시나리오(31번)는 이것을 쓴다.
 */
export async function shipLineOut(tx: DbTx, salesOrderLineId: string): Promise<void> {
  const items = await tx
    .select({ id: wmsTables.fulfillmentOrderItems.id, qty: wmsTables.fulfillmentOrderItems.qty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId));
  for (const item of items) {
    const lines = await tx
      .select({ id: wmsTables.shipmentLines.id, warehouseId: wmsTables.shipments.warehouseId })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(
        and(
          eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id),
          inArray(wmsTables.shipments.status, ['draft', 'planned']),
        ),
      );
    if (lines.length > 0) {
      const [shipped] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: lines[0].warehouseId, status: 'shipped', shippedAt: new Date() })
        .returning();
      const lineIds = lines.map((line) => line.id);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: shipped.id })
        .where(inArray(wmsTables.shipmentLines.id, lineIds));
      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'released' })
        .where(
          and(
            inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
    }
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: item.qty })
      .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
  }
}

/**
 * 취소 요청 통합 스펙의 배선. 롤백 트랜잭션 하나에 판매주문·요청 reader/manager 를 묶는다.
 */
export function wireCancelRequest(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  const reader = new ChannelCancelRequestReader();
  const manager = new ChannelCancelRequestManager(
    dbService,
    reader,
    salesOrders,
    outboxPublisherFor(CHANNEL_ORDERS_COMMAND_STREAM, dbService),
  );
  const settler = new ChannelCancelSettler(reader);
  const amendments = new SalesOrderAmendmentsService(dbService);
  // 실제 커널. 채널 변경이 부르는 수량 감소 갈래는 판매주문 취소와 커널 reader 만 쓴다 — 인쇄 취소 협력자는 비워 둔다
  const cancellation = new OrderCancellation(
    dbService,
    salesOrders,
    new ChannelCancelRequestService(dbService, manager, reader),
    new PrintOrderReader(dbService),
    {} as never,
    settler,
    new OrderCancellationReader(),
  );
  const changes = new ChannelOrderChangeManager(
    new ChannelOrderChangeReader(),
    amendments,
    { get: () => outbound.planning } as never,
    settler,
    cancellation,
  );
  return { dbService, logistics, outbound, salesOrders, reader, manager, settler, amendments, changes };
}

export type CancelWiring = ReturnType<typeof wireCancelRequest>;
