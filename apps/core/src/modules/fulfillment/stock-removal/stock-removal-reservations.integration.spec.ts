import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { InboundService } from '../../inventory/inbound/services/inbound.service';
import {
  Database,
  dbServiceFor,
  inRollbackTx,
  makeInboundReceiptKernel,
  makeInboundReceiptStateReader,
  makeInboundService,
} from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { InboundReceiptStateReader } from '../../inventory/inbound/services/inbound-receipt-state.reader';
import { readWarehouseAvailability } from '../../inventory/shared/availability/warehouse-availability';
import {
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from '../services/__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('입고 취소·회송이 놓는 예약 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;
  let wired: Wired;
  let inbound: InboundService;
  let states: InboundReceiptStateReader;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    wired = wireLogistics(dbServiceFor(db), 'v2');
    inbound = makeInboundService(db);
    states = makeInboundReceiptStateReader(db);
  });

  afterAll(async () => {
    await client.end();
  });

  interface World {
    warehouseId: string;
    skuId: string;
  }
  interface Box {
    lineId: string;
    shipmentId: string;
    fulfillmentOrderId: string;
    orderNo: string;
  }

  async function seedWorld(tx: DbTx): Promise<World> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    return { warehouseId, skuId };
  }

  /** 주문 하나를 상자로 만들고 재고 대기 순번을 `at` 으로 맞춘다. */
  async function addOrder(tx: DbTx, world: World, qty: number, at: string): Promise<Box> {
    const variantId = randomUUID();
    const orderNo = `it-${randomUUID().slice(0, 8)}`;
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: qty, skuId: world.skuId }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ displayOrderNo: orderNo })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await seedMatching(tx, { variantId, skuId: world.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: world.warehouseId }, tx);
    const [row] = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
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
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    await tx
      .update(wmsTables.shipmentLines)
      .set({ createdAt: new Date(at) })
      .where(eq(wmsTables.shipmentLines.id, row.lineId));
    return { ...row, orderNo };
  }

  async function receive(tx: DbTx, world: World, quantity: number) {
    const receipt = await inbound.simpleInbound(
      {
        warehouseId: world.warehouseId,
        items: [{ skuId: world.skuId, quantity }],
        idempotencyKey: randomUUID(),
      },
      tx,
    );
    return { lineId: receipt.lines[0].id };
  }

  const reserve = (tx: DbTx, box: Box) => wired.retryWorker.retryOne(box.lineId, tx);

  const cancel = (tx: DbTx, lineId: string, quantity: number) =>
    inbound.cancelInbound({ lineId, quantity, idempotencyKey: randomUUID() }, tx);

  async function boxOf(tx: DbTx, box: Box) {
    const [line] = await tx
      .select({ reservedQty: wmsTables.shipmentLines.reservedQty })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.lineId));
    const rows = await tx
      .select({ quantity: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.shipmentLineId, box.lineId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return { box: line.reservedQty, confirmed: rows.reduce((total, row) => total + row.quantity, 0) };
  }

  const availability = (tx: DbTx, world: World) => readWarehouseAvailability(tx, world.skuId, world.warehouseId);

  it('예약된 입고도 취소되고, 예약·상자·원장이 입고 전으로 돌아간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const box = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      const { lineId } = await receive(tx, world, 5);
      await reserve(tx, box);
      expect(await boxOf(tx, box)).toEqual({ box: 3, confirmed: 3 });
      const state = await states.getLineState({ lineId, warehouseId: world.warehouseId }, tx);
      expect(state).toMatchObject({
        canCancel: true,
        cancelReservations: { orderCount: 1, quantity: 3, missingQty: 0, heldBy: [] },
      });

      await cancel(tx, lineId, 5);

      expect(await boxOf(tx, box)).toEqual({ box: 0, confirmed: 0 });
      expect(await availability(tx, world)).toEqual({ onHand: 0, reserved: 0, available: 0 });
      // 재시도 워커가 다시 돌아도 없는 재고를 잡지 않는다
      await reserve(tx, box);
      expect(await boxOf(tx, box)).toEqual({ box: 0, confirmed: 0 });
    });
  });

  it('남는 재고로 감당되는 예약은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const box = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      await receive(tx, world, 3);
      await reserve(tx, box);
      const { lineId } = await receive(tx, world, 5);
      const state = await states.getLineState({ lineId, warehouseId: world.warehouseId }, tx);
      expect(state.cancelReservations).toEqual({ orderCount: 0, quantity: 0, missingQty: 0, heldBy: [] });

      await cancel(tx, lineId, 5);

      expect(await boxOf(tx, box)).toEqual({ box: 3, confirmed: 3 });
      expect(await availability(tx, world)).toEqual({ onHand: 3, reserved: 3, available: 0 });
    });
  });

  it('못 나가는 상자에서 먼저, 그다음 뒤에 온 주문에서 부족한 만큼만 놓는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const early = await addOrder(tx, world, 2, '2026-01-01T00:00:00Z');
      const late = await addOrder(tx, world, 2, '2026-01-02T00:00:00Z');
      const short = await addOrder(tx, world, 5, '2025-12-01T00:00:00Z');
      await receive(tx, world, 2);
      await reserve(tx, early);
      const { lineId } = await receive(tx, world, 3);
      await reserve(tx, late);
      await reserve(tx, short);
      expect(await boxOf(tx, short)).toEqual({ box: 1, confirmed: 1 });
      const state = await states.getLineState({ lineId, warehouseId: world.warehouseId }, tx);
      expect(state.cancelReservations).toMatchObject({ orderCount: 2, quantity: 3 });

      await cancel(tx, lineId, 3);

      expect(await boxOf(tx, short)).toEqual({ box: 0, confirmed: 0 });
      expect(await boxOf(tx, late)).toEqual({ box: 0, confirmed: 0 });
      expect(await boxOf(tx, early)).toEqual({ box: 2, confirmed: 2 });
      expect(await availability(tx, world)).toEqual({ onHand: 2, reserved: 2, available: 0 });
    });
  });

  it('우선할당한 주문의 예약은 다른 주문이 놓은 뒤에야 놓는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const priority = await addOrder(tx, world, 2, '2026-01-02T00:00:00Z');
      const normal = await addOrder(tx, world, 2, '2026-01-01T00:00:00Z');
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ stockAllocation: 'priority' })
        .where(eq(wmsTables.fulfillmentOrders.id, priority.fulfillmentOrderId));
      await receive(tx, world, 2);
      const { lineId } = await receive(tx, world, 2);
      await reserve(tx, priority);
      await reserve(tx, normal);

      await cancel(tx, lineId, 2);

      expect(await boxOf(tx, priority)).toEqual({ box: 2, confirmed: 2 });
      expect(await boxOf(tx, normal)).toEqual({ box: 0, confirmed: 0 });
    });
  });

  it('출고 준비에 들어간 주문이 잡은 재고면 주문번호로 거절하고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const planned = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      const draft = await addOrder(tx, world, 1, '2026-01-02T00:00:00Z');
      const { lineId } = await receive(tx, world, 4);
      await reserve(tx, planned);
      await reserve(tx, draft);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));
      const state = await states.getLineState({ lineId, warehouseId: world.warehouseId }, tx);
      expect(state.cancelReservations).toEqual({
        orderCount: 1,
        quantity: 1,
        missingQty: 3,
        heldBy: [{ orderNo: planned.orderNo, quantity: 3 }],
      });

      await expect(tx.transaction((sp) => cancel(sp as unknown as DbTx, lineId, 4))).rejects.toThrow(
        `${planned.orderNo} 3개`,
      );

      expect(await boxOf(tx, draft)).toEqual({ box: 1, confirmed: 1 });
      expect(await availability(tx, world)).toEqual({ onHand: 4, reserved: 4, available: 0 });

      // 배치에서 빠져 다시 준비 전이 되면 같은 입고를 취소할 수 있다
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'draft' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));
      await cancel(tx, lineId, 4);
      expect(await availability(tx, world)).toEqual({ onHand: 0, reserved: 0, available: 0 });
    });
  });

  it('하루 지난 입고도 물건이 원위치에 그대로 있으면 취소된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const { lineId } = await receive(tx, world, 5);
      const [line] = await tx
        .select({ receiptId: wmsTables.inboundReceiptLines.receiptId })
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, lineId));
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ occurredAt: new Date(Date.now() - 2 * 86_400_000) })
        .where(eq(wmsTables.inboundReceipts.id, line.receiptId));
      expect(await states.getLineState({ lineId, warehouseId: world.warehouseId }, tx)).toMatchObject({
        canCancel: true,
        cancelBlockReason: null,
      });

      await cancel(tx, lineId, 5);

      expect(await availability(tx, world)).toEqual({ onHand: 0, reserved: 0, available: 0 });
      await expect(tx.transaction((sp) => cancel(sp as unknown as DbTx, lineId, 5))).rejects.toThrow(
        'already canceled',
      );
    });
  });

  it('회송도 재고보다 많은 예약을 남기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const box = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      const { lineId } = await receive(tx, world, 5);
      await reserve(tx, box);

      await inbound.returnInbound({ lineId, quantity: 4, idempotencyKey: randomUUID() }, tx);

      expect(await boxOf(tx, box)).toEqual({ box: 1, confirmed: 1 });
      expect(await availability(tx, world)).toEqual({ onHand: 1, reserved: 1, available: 0 });
    });
  });

  it('여러 줄을 한꺼번에 취소하면 줄마다의 예약을 한 번에 놓는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await seedWorld(tx);
      const { holderId } = await seedHolder(tx);
      const second: World = { warehouseId: first.warehouseId, skuId: (await seedSku(tx, holderId)).skuId };
      const boxes = [
        await addOrder(tx, first, 2, '2026-01-01T00:00:00Z'),
        await addOrder(tx, second, 3, '2026-01-02T00:00:00Z'),
      ];
      const kernel = makeInboundReceiptKernel(db);
      const arrival = await kernel.recordArrival(
        {
          source: 'inbound_shipment',
          warehouseId: first.warehouseId,
          reason: 'it-box',
          lines: [first, second].map(({ skuId }) => ({ skuId, quantity: 4, eventKey: randomUUID() })),
        },
        tx,
      );
      for (const box of boxes) await reserve(tx, box);
      const ids = arrival.lines.map((line) => line.id);

      await kernel.releaseForCancel(ids, tx);
      for (const box of boxes) expect((await boxOf(tx, box)).confirmed).toBe(0);
      for (const receiptLineId of ids) {
        await kernel.cancelLine({ receiptLineId, expected: { source: 'inbound_shipment' } }, tx);
      }

      for (const box of boxes) expect(await boxOf(tx, box)).toEqual({ box: 0, confirmed: 0 });
      for (const world of [first, second]) {
        expect(await availability(tx, world)).toEqual({ onHand: 0, reserved: 0, available: 0 });
      }
    });
  });

  it('같은 키로 다시 보낸 취소는 한 번만 반영된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx);
      const box = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      await receive(tx, world, 5);
      const { lineId } = await receive(tx, world, 5);
      await reserve(tx, box);
      const dto = { lineId, quantity: 5, idempotencyKey: randomUUID() };
      await inbound.cancelInbound(dto, tx);
      await inbound.cancelInbound(dto, tx);
      expect(await availability(tx, world)).toEqual({ onHand: 5, reserved: 3, available: 2 });
    });
  });
});
