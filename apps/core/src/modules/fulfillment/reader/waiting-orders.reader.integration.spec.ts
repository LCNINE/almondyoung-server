import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeInboundReceiptKernel } from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { inRollbackTx, makeDb, seedPickableShipment, seedShipmentForExistingStock } from '../services/__support__';
import { seedHandedOverOrder } from '../services/__support__/sellmate-handed-over-fixtures';
import { ambientDbService, startBatchFor } from '../services/__support__/simple-outbound-wiring';
import { WaitingOrdersReader } from './waiting-orders.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Box = Awaited<ReturnType<typeof seedPickableShipment>>;

describeIfDb('기다리는 주문', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const waiting = async (tx: DbTx, box: Pick<Box, 'warehouseId' | 'skuId'>) => {
    const [item] = await new WaitingOrdersReader(ambientDbService(tx)).forSkus(box.warehouseId, [box.skuId]);
    return item ? { orders: item.orders, qty: item.qty } : null;
  };

  async function sibling(tx: DbTx, box: Box, qty: number): Promise<Box> {
    const [shipment] = await tx
      .select({ shippingProfileId: wmsTables.shipments.shippingProfileId })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, box.shipmentId));
    return seedShipmentForExistingStock(tx, { ...box, deliveryProfileId: shipment.shippingProfileId ?? '' }, qty);
  }

  const setShelf = (tx: DbTx, box: Box, qty: number) =>
    tx
      .update(wmsTables.stockLedgers)
      .set({ qty })
      .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));

  const dropReservation = (tx: DbTx, box: Box) =>
    tx
      .update(wmsTables.stockReservations)
      .set({ status: 'released' })
      .where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));

  const setShipment = (tx: DbTx, box: Box, values: Partial<typeof wmsTables.shipments.$inferInsert>) =>
    tx.update(wmsTables.shipments).set(values).where(eq(wmsTables.shipments.id, box.shipmentId));

  it('선반 재고로 다 나가면 돌려주지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await sibling(tx, box, 3);
      await setShelf(tx, box, 5);
      expect(await waiting(tx, box)).toBeNull();
    });
  });

  it('입고해 예약이 잡혀도 적치 전에는 그대로이고, 적치한 만큼 줄어든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const next = await sibling(tx, box, 3);
      await dropReservation(tx, next);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 3 });

      const kernel = makeInboundReceiptKernel(tx as never);
      const receipt = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: box.warehouseId,
          reason: 'waiting orders',
          lines: [{ skuId: box.skuId, quantity: 10, eventKey: randomUUID() }],
        },
        tx,
      );
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 3 });

      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'confirmed' })
        .where(eq(wmsTables.stockReservations.shipmentLineId, next.shipmentLineId));
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 3 });

      const putaway = (quantity: number) =>
        kernel.putaway(
          { receiptLineId: receipt.lines[0].id, toLocationId: box.locationId, quantity, eventKey: randomUUID() },
          tx,
        );
      await putaway(1);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 2 });
      await putaway(2);
      expect(await waiting(tx, box)).toBeNull();
    });
  });

  it('시작한 배치가 잡은 몫은 기다리지 않고, 그 재고를 다른 주문의 몫으로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await startBatchFor(tx, box);
      expect(await waiting(tx, box)).toBeNull();

      const next = await sibling(tx, box, 1);
      await dropReservation(tx, next);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 1 });
    });
  });

  it('배치가 쥔 선반 재고로는 적치 전 재고를 예약한 주문이 나가지 못한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await startBatchFor(tx, box);
      await makeInboundReceiptKernel(tx as never).recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: box.warehouseId,
          reason: 'waiting orders',
          lines: [{ skuId: box.skuId, quantity: 1, eventKey: randomUUID() }],
        },
        tx,
      );
      await sibling(tx, box, 1);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 1 });
    });
  });

  it('같은 주문의 두 상자는 한 건이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const next = await sibling(tx, box, 3);
      const [line] = await tx
        .select({ itemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      await tx
        .update(wmsTables.shipmentLines)
        .set({ fulfillmentOrderItemId: line.itemId })
        .where(eq(wmsTables.shipmentLines.id, next.shipmentLineId));
      await setShelf(tx, box, 0);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 5 });
    });
  });

  it('취소된·다른 창고의 상자는 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const canceled = await sibling(tx, box, 3);
      await dropReservation(tx, canceled);
      await setShipment(tx, canceled, { status: 'canceled' });
      const other = await sibling(tx, box, 4);
      await dropReservation(tx, other);
      const [warehouse] = await tx.insert(wmsTables.warehouses).values({ name: randomUUID() }).returning();
      await setShipment(tx, other, { warehouseId: warehouse.id });
      expect(await waiting(tx, box)).toBeNull();
    });
  });

  it('회수 중인 상자가 잡은 예약으로는 예약 없는 주문이 나가지 못한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const recovering = await sibling(tx, box, 3);
      await setShipment(tx, recovering, { status: 'recovery_required', recoveryCode: 'RECALL_PENDING' });
      await dropReservation(tx, box);
      await setShelf(tx, box, 4);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 1 });
    });
  });

  it('회수 중인 상자의 예약이 적치 전 재고로 채워져 있으면 예약한 주문은 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 5);
      const recovering = await sibling(tx, box, 3);
      await setShipment(tx, recovering, { status: 'recovery_required', recoveryCode: 'RECALL_PENDING' });
      await makeInboundReceiptKernel(tx as never).recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: box.warehouseId,
          reason: 'waiting orders',
          lines: [{ skuId: box.skuId, quantity: 3, eventKey: randomUUID() }],
        },
        tx,
      );
      expect(await waiting(tx, box)).toBeNull();
    });
  });

  it('셀메이트에 넘긴 주문은 재고만 쓰고 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const handedOver = await sibling(tx, box, 3);
      const [order] = await tx
        .select({ salesOrderId: wmsTables.fulfillmentOrders.salesOrderId })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
        )
        .where(eq(wmsTables.shipmentLines.id, handedOver.shipmentLineId));
      if (!order.salesOrderId) throw new Error('sales order is required');
      await seedHandedOverOrder(tx, order.salesOrderId);
      await setShelf(tx, box, 5);
      await dropReservation(tx, box);
      expect(await waiting(tx, box)).toBeNull();

      await setShelf(tx, box, 3);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 2 });

      await dropReservation(tx, handedOver);
      await setShelf(tx, box, 0);
      expect(await waiting(tx, box)).toEqual({ orders: 1, qty: 2 });
    });
  });

  it('요청하지 않은 상품은 섞이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await setShelf(tx, box, 0);
      const items = await new WaitingOrdersReader(ambientDbService(tx)).forSkus(box.warehouseId, [
        randomUUID(),
        box.skuId,
        box.skuId,
      ]);
      expect(items).toEqual([{ skuId: box.skuId, orders: 1, qty: 2 }]);
    });
  });
});
