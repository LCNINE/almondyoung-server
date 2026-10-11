import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
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
import { PoliciesService } from '../../services/policies.service';
import { SalesOrdersService } from '../../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../../services/sales-order-amendments.service';
import { ChannelOrderChangeManager } from '../../channel-order-change/channel-order-change.manager';
import { ChannelOrderChangeReader } from '../../channel-order-change/channel-order-change.reader';
import { ChannelCancelSettler } from '../channel-cancel-settler';
import { ChannelCancelRequestManager } from '../channel-cancel-request.manager';
import { ChannelCancelRequestReader } from '../channel-cancel-request.reader';
import { CHANNEL_CANCEL_REQUEST_REASON } from '../channel-cancel-request.types';

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
 * PR 5 전에 만들어진 «requested» 요청 행 — 라이브에 남은 옛 행의 모양(물리 미적용·출고 보류). manager.request 는 이제 이 행을 만들지 않는다.
 * 옛 규칙([다시 보내기]·[요청 접기]·옛 사실·수집 때 적용)이 끝까지 도는지 보는 스펙이 쓴다.
 */
export async function seedLegacyRequest(
  tx: DbTx,
  seed: SeededOrder,
  opts: { lines?: Array<{ salesOrderLineId: string; quantity: number }>; stage?: 'edited'; appliedAt?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const scope: 'full' | 'partial' = opts.lines ? 'partial' : 'full';
  const lines =
    opts.lines ?? seed.lineIds.map((salesOrderLineId, i) => ({ salesOrderLineId, quantity: seed.lines[i].qty }));
  const itemOf = (lineId: string) => seed.lines[seed.lineIds.indexOf(lineId)].item;
  const requestedAt = new Date().toISOString();
  await tx.insert(wmsTables.salesOrderAmendments).values({
    id,
    salesOrderId: seed.salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
    deltas: lines.map((l) => ({
      type: 'cancel_line',
      salesOrderLineId: l.salesOrderLineId,
      channelOrderItemId: itemOf(l.salesOrderLineId),
      quantity: l.quantity,
    })),
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: seed.externalOrderId,
      request: {
        kind: 'cancel',
        scope,
        requestedBy: 'admin:7d0a3c6e-0000-4000-8000-000000000001',
        sourceKey: `legacy-${id}`,
        ...(opts.stage ? { stage: opts.stage } : {}),
        ...(opts.appliedAt ? { appliedAt: opts.appliedAt } : {}),
        command: {
          requestId: id,
          salesChannel: 'medusa',
          externalOrderId: seed.externalOrderId,
          scope,
          ...(scope === 'partial'
            ? { lines: lines.map((l) => ({ channelOrderItemId: itemOf(l.salesOrderLineId), quantity: l.quantity })) }
            : {}),
          requestedBy: 'operator',
          requestedAt,
        },
      },
    },
    origin: 'operator',
    status: 'requested',
    occurredAt: new Date(requestedAt),
  });
  return id;
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
    new PoliciesService(dbService),
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
  const settler = new ChannelCancelSettler(reader, salesOrders);
  const amendments = new SalesOrderAmendmentsService(dbService);
  const changes = new ChannelOrderChangeManager(
    new ChannelOrderChangeReader(salesOrders),
    salesOrders,
    amendments,
    { get: () => outbound.planning } as never,
    settler,
  );
  return { dbService, logistics, outbound, salesOrders, reader, manager, settler, amendments, changes };
}

export type CancelWiring = ReturnType<typeof wireCancelRequest>;
