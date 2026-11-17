import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { ORDER_STREAM, type OrderCancelledPayload } from '@packages/event-contracts/streams/orders.stream';
import type { EnvelopeOf } from '@packages/event-contracts/types';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { OrderEventsConsumer } from '../consumers/order-events.consumer';
import {
  CHANNEL_CANCEL_REQUEST_REASON,
  type CancelRequestLine,
  type CancelRequestMetadata,
} from '../channel-cancel-request/channel-cancel-request.types';
import {
  seedChannelOrder,
  shipLineOut,
  wireCancelRequest,
  type CancelWiring,
  type SeededOrder,
} from '../channel-cancel-request/__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 수집된 채널 취소를 받는 실제 컨슈머 — OrderCancelled 경로가 쓰는 의존성만 실제로 잇는다 */
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

function envelope(): EnvelopeOf<typeof ORDER_STREAM, 'OrderCancelled'> {
  // 핸들러가 읽는 건 messageId·correlationId 뿐이다
  return { messageId: randomUUID(), correlationId: randomUUID() } as unknown as EnvelopeOf<
    typeof ORDER_STREAM,
    'OrderCancelled'
  >;
}

/** 네이버 수집이 내는 취소 사실. `cancelledLines` 의 수량은 그 줄의 채널 누적 취소 수량이다 */
function orderCancelled(
  seed: SeededOrder,
  cancelledLines?: Array<{ channelOrderItemId: string; quantity: number }>,
): OrderCancelledPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'naver',
    externalOrderId: seed.externalOrderId,
    reason: 'CUSTOMER_REQUEST',
    cancelledBy: 'naver',
    cancelledAt: new Date().toISOString(),
    refundRequired: false,
    ...(cancelledLines ? { cancelledLines } : {}),
  };
}

/** core 가 먼저 한 취소(요청 순간 취소 — Task 4 의 문이 하는 일) */
async function coreCancels(w: CancelWiring, tx: DbTx, salesOrderId: string, lines: Array<[string, number]>) {
  await w.salesOrders.cancel(
    salesOrderId,
    {
      lines: lines.map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity })),
      cancelledBy: 'naver',
      reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
      metadata: { sourceEventId: `cancel-request:${randomUUID()}` },
    },
    tx,
  );
}

/** 정산 중 요청 행 — `ChannelCancelRequestManager.request` 가 넣는 모양 그대로 */
async function seedSettlingRequest(
  tx: DbTx,
  seed: SeededOrder,
  requestedBy: string,
  deltas: CancelRequestLine[],
): Promise<string> {
  const id = randomUUID();
  const at = new Date();
  const command: CancelChannelOrderPayload = {
    requestId: id,
    salesChannel: 'naver',
    externalOrderId: seed.externalOrderId,
    scope: 'partial',
    lines: deltas.map((line) => ({ channelOrderItemId: line.channelOrderItemId ?? '', quantity: line.quantity })),
    refundMode: 'auto',
    requestedBy: 'operator',
    requestedAt: at.toISOString(),
  };
  const metadata: CancelRequestMetadata = {
    salesChannel: 'naver',
    externalOrderId: seed.externalOrderId,
    request: {
      kind: 'cancel',
      scope: 'partial',
      requestedBy,
      sourceKey: `channel-request:${randomUUID()}`,
      appliedAt: at.toISOString(),
      command,
    },
    settlement: { state: 'in_progress', mode: 'auto', since: at.toISOString() },
  };
  await tx.insert(wmsTables.salesOrderAmendments).values({
    id,
    salesOrderId: seed.salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
    deltas,
    metadata,
    origin: 'operator',
    status: 'settling',
    occurredAt: at,
    createdAt: at,
  });
  return id;
}

/**
 * 줄의 판매 단위 `units` 개만 나간 모양 — 활성 박스 줄에서 그만큼 떼어 출고된 박스로 옮기고 출고 수량·예약을 맞춘다.
 * `shipLineOut` 의 일부 버전이다(FOI 비율 1 이라 판매 단위 = 물리 수량).
 */
async function shipUnitsOut(tx: DbTx, salesOrderLineId: string, units: number): Promise<void> {
  const [item] = await tx
    .select({ id: wmsTables.fulfillmentOrderItems.id, skuId: wmsTables.fulfillmentOrderItems.skuId })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId));
  const [active] = await tx
    .select({
      id: wmsTables.shipmentLines.id,
      qty: wmsTables.shipmentLines.qty,
      reservedQty: wmsTables.shipmentLines.reservedQty,
      warehouseId: wmsTables.shipments.warehouseId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
    .where(
      and(
        eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id),
        inArray(wmsTables.shipments.status, ['draft', 'planned']),
      ),
    );
  const [shipped] = await tx
    .insert(wmsTables.shipments)
    .values({ warehouseId: active.warehouseId, status: 'shipped', shippedAt: new Date() })
    .returning();
  await tx
    .insert(wmsTables.shipmentLines)
    .values({ shipmentId: shipped.id, fulfillmentOrderItemId: item.id, skuId: item.skuId, qty: units });
  await tx
    .update(wmsTables.shipmentLines)
    .set({ qty: active.qty - units, reservedQty: Math.min(active.reservedQty, active.qty - units) })
    .where(eq(wmsTables.shipmentLines.id, active.id));
  const reservations = await tx
    .select({ id: wmsTables.stockReservations.id, quantity: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.shipmentLineId, active.id),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  for (const reservation of reservations) {
    await tx
      .update(wmsTables.stockReservations)
      .set({ quantity: reservation.quantity - units })
      .where(eq(wmsTables.stockReservations.id, reservation.id));
  }
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty: units })
    .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
}

async function salesOrderStatus(tx: DbTx, salesOrderId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ status: wmsTables.salesOrders.status })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  return row?.status;
}

async function requestStatus(tx: DbTx, id: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ status: wmsTables.salesOrderAmendments.status })
    .from(wmsTables.salesOrderAmendments)
    .where(
      and(
        eq(wmsTables.salesOrderAmendments.id, id),
        eq(wmsTables.salesOrderAmendments.reasonCode, CHANNEL_CANCEL_REQUEST_REASON),
      ),
    );
  return row?.status;
}

async function cancellationCount(tx: DbTx, salesOrderId: string): Promise<number> {
  const rows = await tx
    .select({ id: wmsTables.salesOrderCancellations.id })
    .from(wmsTables.salesOrderCancellations)
    .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
  return rows.length;
}

async function cancelledOf(tx: DbTx, salesOrderId: string, salesOrderLineId: string): Promise<number | undefined> {
  return (await readLineQuantities(tx, salesOrderId)).get(salesOrderLineId)?.canceled;
}

describeIfDb('마켓 채널 취소 수집 — 줄 취소는 누적 수량 상태 (DB integration, rollback-only, 스펙 §5.4)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function naverOrder(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true, salesChannel: 'naver', quantities: [3, 2] });
    const [lineA, lineB] = seed.lineIds;
    const [itemA, itemB] = seed.lines.map((line) => line.item);
    return { w, seed, consumer: consumerOf(w), lineA, lineB, itemA, itemB };
  }

  it('line cancel arriving after core already cancelled the same quantity is a no-op', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 3]]);
      const before = await cancellationCount(tx, seed.salesOrderId);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancellationCount(tx, seed.salesOrderId)).toBe(before);
    });
  });

  it('line cancel with a larger cumulative quantity cancels only the difference', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, lineB, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 1]]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(0);
    });
  });

  it('full OrderCancelled after every line was cancelled line-by-line is a no-op', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, lineB } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 3]]);
      await coreCancels(w, tx, seed.salesOrderId, [[lineB, 2]]);
      const before = await cancellationCount(tx, seed.salesOrderId);

      expect(await salesOrderStatus(tx, seed.salesOrderId)).not.toBe('cancelled');

      await consumer.handleOrderCancelled(orderCancelled(seed), envelope());

      expect(await cancellationCount(tx, seed.salesOrderId)).toBe(before);
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(2);
      // 다시 취소하지 않아도 상태는 맞춘다 — 수량 0 인 주문이 확정 상태로 남지 않는다
      expect(await salesOrderStatus(tx, seed.salesOrderId)).toBe('cancelled');
    });
  });

  it('market request row closes when the collected cancel covers it', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 3]]);
      const requestId = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:na`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3 },
      ]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      expect(await requestStatus(tx, requestId)).toBe('applied');
    });
  });

  it('market request row stays settling while the collected cancel does not cover it yet', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, lineB, itemA, itemB } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [
        [lineA, 3],
        [lineB, 2],
      ]);
      const requestId = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:na`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3 },
        { type: 'cancel_line', salesOrderLineId: lineB, channelOrderItemId: itemB, quantity: 2 },
      ]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      expect(await requestStatus(tx, requestId)).toBe('settling');
    });
  });

  it('two sequential partial requests on the same line — the first collected cancel closes only the first row', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 1]]);
      const first = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:c1`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 1, cancelledBefore: 0 },
      ]);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 1]]);
      const second = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:c2`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 1, cancelledBefore: 1 },
      ]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 1 }]),
        envelope(),
      );
      expect(await requestStatus(tx, first)).toBe('applied');
      expect(await requestStatus(tx, second)).toBe('settling');

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 2 }]),
        envelope(),
      );
      expect(await requestStatus(tx, second)).toBe('applied');
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(2);
    });
  });

  it('a two-line market request row closes after both lines arrive in separate events', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, lineB, itemA, itemB } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [
        [lineA, 3],
        [lineB, 2],
      ]);
      const requestId = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:na`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3, cancelledBefore: 0 },
        { type: 'cancel_line', salesOrderLineId: lineB, channelOrderItemId: itemB, quantity: 2, cancelledBefore: 0 },
      ]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );
      expect(await requestStatus(tx, requestId)).toBe('settling');

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemB, quantity: 2 }]),
        envelope(),
      );
      expect(await requestStatus(tx, requestId)).toBe('applied');
    });
  });

  it('a line cancel does not close request rows that are not market customer requests', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 3]]);
      const requestId = await seedSettlingRequest(tx, seed, 'operator:7d0a3c6e-0000-4000-8000-000000000001', [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3 },
      ]);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      expect(await requestStatus(tx, requestId)).toBe('settling');
    });
  });

  it('full OrderCancelled closes a partial market request row as applied, not superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, lineA, lineB, itemA } = await naverOrder(tx);
      await coreCancels(w, tx, seed.salesOrderId, [[lineA, 3]]);
      const requestId = await seedSettlingRequest(tx, seed, `channel-customer:${itemA}:na`, [
        { type: 'cancel_line', salesOrderLineId: lineA, channelOrderItemId: itemA, quantity: 3 },
      ]);

      await consumer.handleOrderCancelled(orderCancelled(seed), envelope());

      expect(await requestStatus(tx, requestId)).toBe('applied');
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(2);
    });
  });

  it('market OrderCancelled on a shipped line does not throw', async () => {
    await inRollbackTx(db, async (tx) => {
      const { seed, consumer, lineA, itemA } = await naverOrder(tx);
      await shipLineOut(tx, lineA);

      await expect(
        consumer.handleOrderCancelled(orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]), envelope()),
      ).resolves.toBeUndefined();
      // 나간 줄은 취소되지 않는다 — 출고 뒤 후속 효과(회수·반품)의 몫
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(0);
    });
  });

  it('market OrderCancelled on a partially dispatched line cancels the outstanding units', async () => {
    await inRollbackTx(db, async (tx) => {
      const { seed, consumer, lineA, lineB, itemA } = await naverOrder(tx);
      await shipUnitsOut(tx, lineA, 1);

      await consumer.handleOrderCancelled(
        orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]),
        envelope(),
      );

      // 나간 1 단위만 남고 멈출 수 있는 2 단위는 취소된다
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(2);
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(0);
    });
  });

  it('a ConflictException on the market path still throws', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, consumer, itemA } = await naverOrder(tx);
      jest.spyOn(w.salesOrders, 'cancel').mockRejectedValueOnce(new ConflictException('composition not frozen'));

      // 409 는 데이터가 어긋났다는 뜻이다 — 삼키지 않고 재시도·DLQ 로 보낸다(커널의 수신 savepoint 가 되돌린다)
      await expect(
        consumer.handleOrderCancelled(orderCancelled(seed, [{ channelOrderItemId: itemA, quantity: 3 }]), envelope()),
      ).rejects.toThrow('composition not frozen');
    });
  });
});
