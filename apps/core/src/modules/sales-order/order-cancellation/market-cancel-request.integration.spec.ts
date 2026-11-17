import { randomUUID } from 'crypto';
import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import {
  ORDER_STREAM,
  type ChannelCancelRequestedPayload,
  type OrderCancelledPayload,
} from '@packages/event-contracts/streams/orders.stream';
import type { EnvelopeOf } from '@packages/event-contracts/types';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedTwoBoxBatch } from '../../fulfillment/services/__support__/simple-outbound-fixtures';
import type { PickableShipmentFixture } from '../../fulfillment/services/__support__/logistics-fixtures';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { OrderEventsConsumer } from '../consumers/order-events.consumer';
import { CHANNEL_CANCEL_REQUEST_REASON } from '../channel-cancel-request/channel-cancel-request.types';
import {
  seedChannelOrder,
  shipLineOut,
  wireCancelRequest,
  type CancelWiring,
} from '../channel-cancel-request/__support__/cancel-request.fixtures';
import type { ChannelCustomerCancelRequest } from './order-cancellation.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 마켓 사실을 받는 실제 컨슈머 — 이 스펙이 쓰는 두 핸들러의 의존성만 실제로 잇는다 */
function consumerOf(w: CancelWiring): OrderEventsConsumer {
  const unused = {} as never;
  return new OrderEventsConsumer(
    w.salesOrders,
    unused,
    unused,
    unused,
    w.dbService,
    unused,
    unused,
    w.cancellation,
    unused,
  );
}

function envelope<T extends 'OrderCancelled' | 'ChannelCancelRequested'>(): EnvelopeOf<typeof ORDER_STREAM, T> {
  // 핸들러가 읽는 건 messageId·correlationId 뿐이다
  return { messageId: randomUUID(), correlationId: randomUUID() } as unknown as EnvelopeOf<typeof ORDER_STREAM, T>;
}

type Order = { salesChannel: 'naver' | 'coupang'; externalOrderId: string };

/** 마켓 고객 취소요청 하나. 요청 키는 기본으로 새로 만든다(같은 요청의 재관측은 같은 키를 넘긴다) */
function marketRequest(
  order: Order,
  items: Array<{ channelOrderItemId: string; quantity: number }>,
  over: { channelRequestRef?: string; channelRequestKey?: string; needsApproval?: boolean } = {},
): ChannelCustomerCancelRequest {
  const channelRequestRef = over.channelRequestRef ?? 'po-A';
  return {
    salesChannel: order.salesChannel,
    externalOrderId: order.externalOrderId,
    channelRequestRef,
    channelRequestKey: over.channelRequestKey ?? `${channelRequestRef}:${randomUUID().slice(0, 8)}`,
    needsApproval: over.needsApproval ?? true,
    items,
  };
}

function requestedFact(req: ChannelCustomerCancelRequest): ChannelCancelRequestedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: req.salesChannel,
    externalOrderId: req.externalOrderId,
    channelRequestRef: req.channelRequestRef,
    channelRequestKey: req.channelRequestKey,
    needsApproval: req.needsApproval,
    requestedAt: new Date().toISOString(),
    items: req.items,
  };
}

/** 네이버 수집이 내는 취소 사실. `cancelledLines` 의 수량은 그 줄의 채널 누적 취소 수량이다 */
function orderCancelled(
  order: Order,
  cancelledLines: Array<{ channelOrderItemId: string; quantity: number }>,
): OrderCancelledPayload {
  return {
    orderId: randomUUID(),
    salesChannel: order.salesChannel,
    externalOrderId: order.externalOrderId,
    reason: 'CUSTOMER_REQUEST',
    cancelledBy: order.salesChannel,
    cancelledAt: new Date().toISOString(),
    refundRequired: false,
    cancelledLines,
  };
}

async function requestsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderAmendments)
    .where(
      and(
        eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
        eq(wmsTables.salesOrderAmendments.reasonCode, CHANNEL_CANCEL_REQUEST_REASON),
      ),
    );
}

async function commandsOf(tx: DbTx, order: Order) {
  return tx.execute<{ event_type: string; payload: { payload: Record<string, unknown> } }>(
    drizzleSql`SELECT event_type, payload FROM event.outbox_events WHERE aggregate_id = ${`${order.salesChannel}:${order.externalOrderId}`} ORDER BY created_at`,
  );
}

async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}

async function cancelledOf(tx: DbTx, salesOrderId: string, salesOrderLineId: string): Promise<number | undefined> {
  return (await readLineQuantities(tx, salesOrderId)).get(salesOrderLineId)?.canceled;
}

async function shipmentOf(tx: DbTx, shipmentId: string) {
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
  return shipment;
}

async function workItemOf(tx: DbTx, workItemId: string) {
  const [item] = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
  return item;
}

/**
 * 배치 픽스처의 상자를 네이버 주문으로 돌린다 — 상자 하나 = 판매주문 하나·줄 하나. 배치 픽스처는 줄 구성을 굳히지 않으므로
 * (FO 생성이 하는 일) 상자 후 취소가 읽는 구성(판매 단위 1 = SKU 1)을 여기서 넣는다
 */
async function asNaverOrder(tx: DbTx, box: PickableShipmentFixture) {
  const [row] = await tx
    .select({
      salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
  if (!row?.salesOrderId || !row.salesOrderLineId) throw new Error(`box ${box.shipmentId} has no sales order line`);
  const [so] = await tx
    .update(wmsTables.salesOrders)
    .set({ salesChannel: 'naver' })
    .where(eq(wmsTables.salesOrders.id, row.salesOrderId))
    .returning();
  const [line] = await tx
    .select({ channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.id, row.salesOrderLineId));
  if (!line?.channelOrderItemId) throw new Error(`line ${row.salesOrderLineId} has no channel item`);
  await tx
    .insert(wmsTables.salesOrderLineCompositions)
    .values({ salesOrderLineId: row.salesOrderLineId, skuId: box.skuId, qtyPerUnit: 1 });
  return {
    order: { salesChannel: 'naver' as const, externalOrderId: so.channelOrderId },
    salesOrderId: so.id,
    salesOrderLineId: row.salesOrderLineId,
    channelOrderItemId: line.channelOrderItemId,
  };
}

describeIfDb('마켓 고객 취소요청 문 (DB integration, rollback-only, 스펙 §5.2)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 네이버 판매주문 — 줄 A 수량 3·B 수량 2, FO 와 draft 상자까지 */
  async function naverOrder(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true, salesChannel: 'naver', quantities: [3, 2] });
    const [lineA, lineB] = seed.lineIds;
    const [itemA, itemB] = seed.lines.map((line) => line.item);
    const order: Order = { salesChannel: 'naver', externalOrderId: seed.externalOrderId };
    return { w, seed, order, lineA, lineB, itemA, itemB };
  }

  it('unboxed order: request cancels the lines and enqueues CancelChannelOrder with answers', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, lineA, lineB, itemA } = await naverOrder(tx);
      const req = marketRequest(order, [{ channelOrderItemId: itemA, quantity: 3 }]);

      const outcome = await w.cancellation.receiveChannelCustomerRequest(req);

      expect(outcome).toMatchObject({ kind: 'stopped', view: { status: 'settling', scope: 'partial' } });
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(0);

      const [row] = await requestsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('settling');
      expect(row.deltas).toEqual([
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3, cancelledBefore: 0 },
      ]);
      expect(row.metadata).toMatchObject({
        request: {
          requestedBy: `channel-customer:${req.channelRequestKey}`,
          sourceKey: `channel-request:${req.channelRequestKey}`,
        },
        settlement: { state: 'in_progress', mode: 'auto' },
      });

      const commands = await commandsOf(tx, order);
      expect(commands).toHaveLength(1);
      expect(commands[0].event_type).toBe('CancelChannelOrder');
      expect(commands[0].payload.payload).toMatchObject({
        requestId: row.id,
        scope: 'partial',
        lines: [{ channelOrderItemId: itemA, quantity: 3 }],
        refundMode: 'auto',
        requestedBy: 'channel-customer',
        answers: { channelRequestRef: 'po-A', needsApproval: true },
      });

      const cancellations = await cancellationsOf(tx, seed.salesOrderId);
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0].cancelledBy).toBe('naver');
    });
  });

  it('same channelRequestRef twice yields one amendment row and one command', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, lineA, itemA } = await naverOrder(tx);
      const req = marketRequest(order, [{ channelOrderItemId: itemA, quantity: 2 }]);

      const first = await w.cancellation.receiveChannelCustomerRequest(req);
      const again = await w.cancellation.receiveChannelCustomerRequest(req);

      expect(first.kind).toBe('stopped');
      expect(again.kind).toBe('replayed');
      if (first.kind !== 'stopped' || again.kind !== 'replayed') throw new Error('unexpected outcome');
      expect(again.view.id).toBe(first.view.id);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await commandsOf(tx, order)).toHaveLength(1);
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(2);
    });
  });

  it('a second request on the same line records the earlier cancellation as its baseline', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, itemA } = await naverOrder(tx);
      await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(order, [{ channelOrderItemId: itemA, quantity: 1 }]),
      );
      const second = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(order, [{ channelOrderItemId: itemA, quantity: 1 }]),
      );

      expect(second.kind).toBe('stopped');
      if (second.kind !== 'stopped') throw new Error('unexpected outcome');
      const row = (await requestsOf(tx, seed.salesOrderId)).find((r) => r.id === second.view.id);
      expect(row?.deltas).toEqual([expect.objectContaining({ quantity: 1, cancelledBefore: 1 })]);
    });
  });

  it('request for an order core does not have is ignored', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, itemA } = await naverOrder(tx);
      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest({ salesChannel: 'naver', externalOrderId: `ext-${randomUUID()}` }, [
          { channelOrderItemId: itemA, quantity: 1 },
        ]),
      );

      expect(outcome).toEqual({ kind: 'order_unknown' });
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
    });
  });

  it('a line core does not have is not stoppable and leaves no row', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, itemA } = await naverOrder(tx);
      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(order, [
          { channelOrderItemId: itemA, quantity: 1 },
          { channelOrderItemId: 'ci-unknown', quantity: 1 },
        ]),
      );

      expect(outcome.kind).toBe('not_stoppable');
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await commandsOf(tx, order)).toHaveLength(0);
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(0);
    });
  });

  it('dispatched box: request is not stoppable and leaves no row', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, lineA, itemA } = await naverOrder(tx);
      await shipLineOut(tx, lineA);
      const before = await w.salesOrders.getOne(seed.salesOrderId, tx);

      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(order, [{ channelOrderItemId: itemA, quantity: 3 }]),
      );

      expect(outcome.kind).toBe('not_stoppable');
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await commandsOf(tx, order)).toHaveLength(0);
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(0);
      expect((await w.salesOrders.getOne(seed.salesOrderId, tx))?.status).toBe(before?.status);
    });
  });

  it('started batch, whole box requested: box exits the batch', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      await w.outbound.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const box = await asNaverOrder(tx, second);

      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(box.order, [{ channelOrderItemId: box.channelOrderItemId, quantity: 1 }]),
      );

      expect(outcome.kind).toBe('stopped');
      // 집은 게 없으니 그 트랜잭션에서 이탈이 끝난다(batch-cancel-withdraw E10 과 같은 끝)
      expect(await workItemOf(tx, second.workItemId)).toMatchObject({ status: 'excluded', exitTo: 'canceled' });
      expect(await shipmentOf(tx, second.shipmentId)).toMatchObject({ status: 'canceled', recoveryCode: null });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('voided');
      expect(await commandsOf(tx, box.order)).toHaveLength(1);
    });
  });

  it('started batch, part of the box requested: box waits for replan', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      await w.outbound.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const box = await asNaverOrder(tx, first); // 첫 상자는 수량 2

      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(box.order, [{ channelOrderItemId: box.channelOrderItemId, quantity: 1 }]),
      );

      expect(outcome).toMatchObject({ kind: 'stopped', view: { status: 'settling', scope: 'partial' } });
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
      });
      const commands = await commandsOf(tx, box.order);
      expect(commands).toHaveLength(1);
      expect(commands[0].payload.payload).toMatchObject({ scope: 'partial', requestedBy: 'channel-customer' });
    });
  });

  it('started batch, part of the box requested, then the collected cancel of the same cumulative quantity is a no-op and closes the row', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      await w.outbound.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const box = await asNaverOrder(tx, first); // 첫 상자는 수량 2
      const consumer = consumerOf(w);
      const req = marketRequest(box.order, [{ channelOrderItemId: box.channelOrderItemId, quantity: 1 }]);

      await consumer.handleChannelCancelRequested(requestedFact(req), envelope<'ChannelCancelRequested'>());
      const waiting = { status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' };
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject(waiting);
      expect(await cancelledOf(tx, box.salesOrderId, box.salesOrderLineId)).toBe(1);
      const cancellationsBefore = await cancellationsOf(tx, box.salesOrderId);
      expect(cancellationsBefore).toHaveLength(1);
      const commandsBefore = await commandsOf(tx, box.order);

      // 승인 뒤 다음 수집: 그 줄의 채널 누적 취소 수량 1 — core 가 이미 취소한 몫과 같다
      await consumer.handleOrderCancelled(
        orderCancelled(box.order, [{ channelOrderItemId: box.channelOrderItemId, quantity: 1 }]),
        envelope<'OrderCancelled'>(),
      );

      const [closed] = await requestsOf(tx, box.salesOrderId);
      expect(closed.status).toBe('applied');
      expect(await cancelledOf(tx, box.salesOrderId, box.salesOrderLineId)).toBe(1);
      expect(await cancellationsOf(tx, box.salesOrderId)).toHaveLength(cancellationsBefore.length);
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject(waiting);
      expect(await commandsOf(tx, box.order)).toHaveLength(commandsBefore.length);
    });
  });

  it('manual refund switch is refused on a market request row', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, itemA } = await naverOrder(tx);
      const outcome = await w.cancellation.receiveChannelCustomerRequest(
        marketRequest(order, [{ channelOrderItemId: itemA, quantity: 1 }]),
      );
      if (outcome.kind !== 'stopped') throw new Error(`unexpected outcome ${outcome.kind}`);

      const attempt = w.manager.switchToManualRefund(seed.salesOrderId, outcome.view.id, tx);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestError);
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, outcome.view.id, tx)).rejects.toThrow(
        '마켓 주문의 환불은 마켓이 합니다 — 판매자센터에서 처리하세요.',
      );
      expect(await commandsOf(tx, order)).toHaveLength(1);
    });
  });

  it('end to end: a request through the consumer, then the collected cancel closes the row as applied', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, order, lineA, itemA } = await naverOrder(tx);
      const consumer = consumerOf(w);
      const req = marketRequest(order, [{ channelOrderItemId: itemA, quantity: 3 }]);

      await consumer.handleChannelCancelRequested(requestedFact(req), envelope<'ChannelCancelRequested'>());
      const [row] = await requestsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('settling');

      // 승인 뒤 다음 수집이 그 줄의 누적 취소 수량을 가져온다
      await consumer.handleOrderCancelled(
        orderCancelled(order, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope<'OrderCancelled'>(),
      );

      const [closed] = await requestsOf(tx, seed.salesOrderId);
      expect(closed.status).toBe('applied');
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });
});
