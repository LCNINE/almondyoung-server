import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ambientDbService,
  inRollbackTx,
  makeDb,
  onHandAt,
  receiveStock,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;

if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const describeIfDb = DATABASE_URL ? describe : describe.skip;
const initialQuantity = 6;
const manufacturedQuantity = 4;
const demandQuantity = initialQuantity + manufacturedQuantity;

describeIfDb('제조 재고 조정 후 대기 출고 예약을 재시도한다', () => {
  jest.setTimeout(120_000);

  let database: ReturnType<typeof makeDb>;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    database = makeDb(DATABASE_URL);
  });

  afterAll(async () => {
    await database?.sql.end();
  });

  async function reservationState(tx: DbTx, shipmentLineId: string) {
    const [line] = await tx
      .select({
        qty: wmsTables.shipmentLines.qty,
        reservedQty: wmsTables.shipmentLines.reservedQty,
        shipmentStatus: wmsTables.shipments.status,
        fulfillmentStatus: wmsTables.fulfillmentOrders.status,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.shipmentLines.id, shipmentLineId));
    const reservations = await tx
      .select({ quantity: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.shipmentLineId, shipmentLineId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    const confirmedQuantity = reservations.reduce((sum, reservation) => sum + reservation.quantity, 0);

    return { ...line, confirmedQuantity, unreservedQuantity: line.qty - confirmedQuantity };
  }

  async function stockEvents(tx: DbTx, skuId: string) {
    return tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, skuId));
  }

  async function arrange(tx: DbTx) {
    const wired = wireLogistics(ambientDbService(tx), 'v2');
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);

    await receiveStock(wired.command, tx, { skuId, warehouseId, locationId, quantity: initialQuantity });

    const variantId = randomUUID();
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: demandQuantity }] });

    await seedMatching(tx, { variantId, skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);

    const [line] = await tx
      .select({ id: wmsTables.shipmentLines.id })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.skuId, skuId));
    const initialState = await reservationState(tx, line.id);

    expect(wired.workflowGate.shouldRunReservationRetry()).toBe(true);
    expect(initialState).toEqual({
      qty: demandQuantity,
      reservedQty: initialQuantity,
      confirmedQuantity: initialQuantity,
      unreservedQuantity: manufacturedQuantity,
      shipmentStatus: 'draft',
      fulfillmentStatus: 'partially_reserved',
    });
    expect(await onHandAt(tx, skuId, locationId)).toBe(initialQuantity);

    return {
      wired,
      skuId,
      locationId,
      shipmentLineId: line.id,
      initialState,
      adjustInput: {
        skuId,
        warehouseId,
        locationId,
        quantity: manufacturedQuantity,
        reason: '제조',
        idempotencyKey: `manufacture-${randomUUID()}`,
      },
    };
  }

  it('재고가 늘지 않으면 예약 재시도가 부족 수량과 원장을 유지하고 재고 이벤트를 만들지 않는다', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const fixture = await arrange(tx);
      const eventsBefore = await stockEvents(tx, fixture.skuId);

      expect(eventsBefore).toHaveLength(1);

      await fixture.wired.retryWorker.retryUnfulfillable();

      expect(await reservationState(tx, fixture.shipmentLineId)).toEqual(fixture.initialState);
      expect(await onHandAt(tx, fixture.skuId, fixture.locationId)).toBe(initialQuantity);
      expect(await stockEvents(tx, fixture.skuId)).toEqual(eventsBefore);
    });
  });

  it('제조 수량을 재고 조정으로 등록하면 예약 재시도가 부족분을 채우고 출고요청을 준비 완료로 바꾼다', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const fixture = await arrange(tx);
      const result = await fixture.wired.command.adjustUp(fixture.adjustInput);

      expect(await onHandAt(tx, fixture.skuId, fixture.locationId)).toBe(demandQuantity);
      expect(await reservationState(tx, fixture.shipmentLineId)).toEqual(fixture.initialState);

      await fixture.wired.retryWorker.retryUnfulfillable();

      expect(await reservationState(tx, fixture.shipmentLineId)).toEqual({
        qty: demandQuantity,
        reservedQty: demandQuantity,
        confirmedQuantity: demandQuantity,
        unreservedQuantity: 0,
        shipmentStatus: 'draft',
        fulfillmentStatus: 'ready',
      });
      expect(await onHandAt(tx, fixture.skuId, fixture.locationId)).toBe(demandQuantity);

      const events = await stockEvents(tx, fixture.skuId);

      expect(events).toHaveLength(2);
      expect(events.filter((event) => event.transitionType === 'ADJUST_UP')).toEqual([
        expect.objectContaining({
          id: result.eventId,
          transitionType: 'ADJUST_UP',
          quantity: manufacturedQuantity,
          reason: '제조',
          toWarehouseId: fixture.adjustInput.warehouseId,
          toLocationId: fixture.locationId,
          idempotencyKey: fixture.adjustInput.idempotencyKey,
        }),
      ]);
    });
  });

  it('같은 멱등키로 제조 재고 조정을 반복하면 증가 이벤트가 하나만 남고 원장 수량이 유지된다', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const fixture = await arrange(tx);
      const first = await fixture.wired.command.adjustUp(fixture.adjustInput);

      await fixture.wired.retryWorker.retryUnfulfillable();

      const replay = await fixture.wired.command.adjustUp(fixture.adjustInput);
      const events = await stockEvents(tx, fixture.skuId);

      expect(replay.eventId).toBe(first.eventId);
      expect(events).toHaveLength(2);
      expect(events.filter((event) => event.transitionType === 'ADJUST_UP')).toHaveLength(1);
      expect(await onHandAt(tx, fixture.skuId, fixture.locationId)).toBe(demandQuantity);
      expect(await reservationState(tx, fixture.shipmentLineId)).toMatchObject({
        confirmedQuantity: demandQuantity,
        unreservedQuantity: 0,
        fulfillmentStatus: 'ready',
      });
    });
  });
});
