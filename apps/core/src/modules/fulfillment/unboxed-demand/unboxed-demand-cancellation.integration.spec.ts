import * as postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { UnboxedDemandCancellation } from './unboxed-demand-cancellation';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('상자 전 수요 취소 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let cmd: UnboxedDemandCancellation;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    cmd = new UnboxedDemandCancellation(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  const foi = (tx: DbTx, id: string) =>
    tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, id))
      .then((r) => r[0]);
  const fo = (tx: DbTx, id: string) =>
    tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, id))
      .then((r) => r[0]);

  it('직배 FO 부분 감소는 canceledQty 만 늘리고 qty·FO 상태는 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const order = await f.seedOrder(tx, { quantity: 3 });
      const { foId, foItemId } = await f.seedFo(tx, w, order, { qty: 3, dropShip: 'pending', status: 'created' });

      await cmd.lockForCancellation(order.salesOrderId, tx);
      const reduced = await cmd.reduce(order.salesOrderId, [{ fulfillmentOrderItemId: foItemId, qty: 1 }], tx);

      expect(await foi(tx, foItemId)).toMatchObject({ qty: 3, canceledQty: 1, status: 'pending' });
      expect(await fo(tx, foId)).toMatchObject({ status: 'created', totalQty: 3, canceledAt: null });
      expect(reduced).toEqual([
        expect.objectContaining({
          fulfillmentOrderItemId: foItemId,
          qty: 1,
          previousCanceledQty: 0,
          newCanceledQty: 1,
          previousStatus: 'pending',
          newStatus: 'pending',
        }),
      ]);
    });
  });

  it('전량 감소면 FOI·FO 가 canceled, canceledAt 이 찍힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const order = await f.seedOrder(tx, { quantity: 2 });
      const { foId, foItemId } = await f.seedFo(tx, w, order, { qty: 2, dropShip: 'pending', status: 'created' });

      await cmd.lockForCancellation(order.salesOrderId, tx);
      await cmd.reduce(order.salesOrderId, [{ fulfillmentOrderItemId: foItemId, qty: 2 }], tx);

      expect(await foi(tx, foItemId)).toMatchObject({ qty: 2, canceledQty: 2, status: 'canceled' });
      const after = await fo(tx, foId);
      expect(after.status).toBe('canceled');
      expect(after.canceledAt).toBeInstanceOf(Date);
    });
  });

  it('cancellableQty 는 앞선 취소·피킹을 빼고, created·ready 가 아닌 FO 는 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const order = await f.seedOrder(tx, { quantity: 4 });
      const { foItemId } = await f.seedFo(tx, w, order, { qty: 4, status: 'ready' });
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ canceledQty: 1, pickedQty: 1 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));

      const [item] = await cmd.lockForCancellation(order.salesOrderId, tx);
      expect(item).toMatchObject({ fulfillmentOrderItemId: foItemId, qty: 4, canceledQty: 1, cancellableQty: 2 });
    });
    for (const status of ['partially_reserved', 'processing'] as const) {
      await inRollbackTx(db, async (tx) => {
        const w = await f.seedWorld(tx);
        const order = await f.seedOrder(tx, { quantity: 4 });
        await f.seedFo(tx, w, order, {
          qty: 4,
          status: status === 'partially_reserved' ? 'partially_reserved' : 'processing',
        });
        const [item] = await cmd.lockForCancellation(order.salesOrderId, tx);
        expect(item.cancellableQty).toBe(0);
      });
    }
  });

  it('cancellableQty 를 넘는 감소는 던진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const order = await f.seedOrder(tx, { quantity: 2 });
      const { foItemId } = await f.seedFo(tx, w, order, { qty: 2, dropShip: 'pending', status: 'created' });

      await cmd.lockForCancellation(order.salesOrderId, tx);
      await expect(cmd.reduce(order.salesOrderId, [{ fulfillmentOrderItemId: foItemId, qty: 3 }], tx)).rejects.toThrow(
        /exceeds cancellable/,
      );
      expect(await foi(tx, foItemId)).toMatchObject({ qty: 2, canceledQty: 0 });
    });
  });

  it('확정 예약이 있는 상자 전 FO 는 잠글 때 던진다 (N13)', async () => {
    for (const [status, throws] of [
      ['confirmed', true],
      ['released', false],
    ] as const) {
      await inRollbackTx(db, async (tx) => {
        const w = await f.seedWorld(tx);
        const order = await f.seedOrder(tx);
        const { foId, foItemId } = await f.seedFo(tx, w, order, { status: 'ready' });
        const [shipment] = await tx
          .insert(wmsTables.shipments)
          .values({ warehouseId: w.warehouseId, status: 'draft', openedForFulfillmentOrderId: foId })
          .returning();
        const [line] = await tx
          .insert(wmsTables.shipmentLines)
          .values({ shipmentId: shipment.id, fulfillmentOrderItemId: foItemId, skuId: w.skuId, qty: 1 })
          .returning();
        await tx.insert(wmsTables.stockReservations).values({
          targetType: 'FULFILLMENT_ORDER',
          targetId: foId,
          shipmentLineId: line.id,
          skuId: w.skuId,
          warehouseId: w.warehouseId,
          quantity: 1,
          status,
        });

        const locked = cmd.lockForCancellation(order.salesOrderId, tx);
        if (throws) await expect(locked).rejects.toThrow(/has confirmed reservations/);
        else await expect(locked).resolves.toHaveLength(1);
      });
    }
  });

  it('cancelOrder 는 created·ready FO 만 취소한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const order = await f.seedOrder(tx, { quantity: 2 });
      const a = await f.seedFo(tx, w, order, { qty: 2, dropShip: 'pending', status: 'created' });
      const [a2] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: a.foId,
          salesOrderId: order.salesOrderId,
          salesOrderLineId: order.lineId,
          skuId: w.skuId,
          qty: 5,
        })
        .returning();
      // 주문당 FO 는 하나(uq_fulfillment_orders_sales_order)라 B 는 다른 주문에 둔다 — 상태가 안 맞는 FO 는 건드리지 않는 것만 본다
      const orderB = await f.seedOrder(tx);
      const b = await f.seedFo(tx, w, orderB, { status: 'partially_reserved' });

      const result = await cmd.cancelOrder(order.salesOrderId, tx);
      const resultB = await cmd.cancelOrder(orderB.salesOrderId, tx);

      expect(await foi(tx, a.foItemId)).toMatchObject({ canceledQty: 2, status: 'canceled' });
      expect(await foi(tx, a2.id)).toMatchObject({ canceledQty: 5, status: 'canceled' });
      const afterA = await fo(tx, a.foId);
      expect(afterA.status).toBe('canceled');
      expect(afterA.canceledAt).toBeInstanceOf(Date);
      expect(result).toEqual([{ fulfillmentOrderId: a.foId, previousStatus: 'created' }]);

      expect(resultB).toEqual([]);
      expect(await foi(tx, b.foItemId)).toMatchObject({ canceledQty: 0 });
      expect((await fo(tx, b.foId)).status).toBe('partially_reserved');
    });
  });
});
