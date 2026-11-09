import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import {
  inRollbackTx,
  makeDb,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { seedCancellableOrder, wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';
import { markLineStateDirty } from './line-state-dirty';
import { publishDirtyLineStates } from './line-state.publisher';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function versionsOf(tx: DbTx, salesOrderId: string) {
  const [row] = await tx
    .select({
      version: wmsTables.salesOrders.lineStateVersion,
      published: wmsTables.salesOrders.lineStatePublishedVersion,
    })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  return row;
}

async function lineStateEventsOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select({ idempotencyKey: outbox_events.idempotencyKey, partitionKey: outbox_events.partitionKey })
    .from(outbox_events)
    .where(
      and(eq(outbox_events.aggregateId, salesOrderId), eq(outbox_events.eventType, 'SalesOrderLineReservationState')),
    );
}

describeIfDb('줄 상태 더러움 표시 지점 (#1247)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('reservePartial 한 번 → 그 주문의 line_state_version 이 1 오른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const wired = wireLogistics(ambientDbService(tx));
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 6 });
      const variantId = randomUUID();
      const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 10 }] });
      await seedMatching(tx, { variantId, skuId });
      await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);

      const [line] = await tx
        .select({ id: wmsTables.shipmentLines.id })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId));
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 8 })
        .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.warehouseId, warehouseId)));
      const before = await versionsOf(tx, salesOrderId);
      expect(before.version).toBeGreaterThan(0); // FO 생성의 첫 예약도 같은 문을 지났다

      const result = await wired.shipmentReservations.reservePartial(line.id, 10, tx);

      expect(result.mutated).toBe(true);
      expect((await versionsOf(tx, salesOrderId)).version).toBe(before.version + 1);
    });
  });

  it('출고 전 취소 기록 → line_state_version 이 오른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      const before = await versionsOf(tx, o.salesOrderId);

      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      expect((await versionsOf(tx, o.salesOrderId)).version).toBeGreaterThan(before.version);
    });
  });

  it('한 트랜잭션에서 두 번 표시 → 폴러는 최신 버전 하나로 이벤트 하나만 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 2 }] });
      await markLineStateDirty(tx, [salesOrderId]);
      await markLineStateDirty(tx, [salesOrderId, salesOrderId]); // 중복 id 는 한 번만 오른다
      expect(await versionsOf(tx, salesOrderId)).toEqual({ version: 2, published: 0 });

      const publisher = outboxPublisherFor(CORE_ORDER_STREAM, ambientDbService(tx));
      await publishDirtyLineStates(tx, publisher, { limit: 10_000, asOf: new Date() });

      expect(await lineStateEventsOf(tx, salesOrderId)).toEqual([
        { idempotencyKey: `so-line-state:${salesOrderId}:2`, partitionKey: salesOrderId },
      ]);
      expect(await versionsOf(tx, salesOrderId)).toEqual({ version: 2, published: 2 });
    });
  });
});
