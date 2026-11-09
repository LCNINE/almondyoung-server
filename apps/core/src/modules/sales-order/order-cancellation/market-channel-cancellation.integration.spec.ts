import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
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

      await consumer.handleOrderCancelled(orderCancelled(seed), envelope());

      expect(await cancellationCount(tx, seed.salesOrderId)).toBe(before);
      expect(await cancelledOf(tx, seed.salesOrderId, lineA)).toBe(3);
      expect(await cancelledOf(tx, seed.salesOrderId, lineB)).toBe(2);
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
});
