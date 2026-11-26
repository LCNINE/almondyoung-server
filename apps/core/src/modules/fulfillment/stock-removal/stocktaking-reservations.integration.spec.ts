import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  buildWiring,
  Database,
  dbServiceFor,
  inRollbackTx,
} from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { readWarehouseAvailability } from '../../inventory/shared/availability/warehouse-availability';
import { StocktakingService } from '../../inventory/stocktaking/services/stocktaking.service';
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

describeIfDb('실사로 재고가 줄 때 넘친 예약 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;
  let wired: Wired;
  let wiring: ReturnType<typeof buildWiring>;
  let stocktaking: StocktakingService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    wired = wireLogistics(dbServiceFor(db), 'v2');
    wiring = buildWiring(db);
    stocktaking = new StocktakingService(wiring.dbService, wiring.command, wiring.reservations);
  });

  afterAll(async () => {
    await client.end();
  });

  interface World {
    warehouseId: string;
    skuId: string;
    barcode: string;
    shelf: { id: string; code: string };
  }
  interface Box {
    lineId: string;
    shipmentId: string;
    orderNo: string;
    at: Date;
  }

  async function seedWorld(tx: DbTx, onShelf: number): Promise<World> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [shelf] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId, code: `COUNT-${randomUUID()}`, locationType: 'zone' })
      .returning();
    const barcode = `COUNT-${randomUUID()}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary: true });
    await stock(tx, { warehouseId, skuId, locationId: shelf.id }, onShelf);
    return { warehouseId, skuId, barcode, shelf };
  }

  const stock = (tx: DbTx, at: { warehouseId: string; skuId: string; locationId: string }, quantity: number) =>
    wiring.command.adjustUp({ ...at, quantity, reason: 'test fixture', idempotencyKey: randomUUID() }, tx);

  async function addOrder(tx: DbTx, world: World, qty: number, at: string): Promise<Box> {
    const variantId = randomUUID();
    const orderNo = `it-${randomUUID().slice(0, 8)}`;
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: qty }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ displayOrderNo: orderNo })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await seedMatching(tx, { variantId, skuId: world.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: world.warehouseId }, tx);
    const [row] = await tx
      .select({ lineId: wmsTables.shipmentLines.id, shipmentId: wmsTables.shipmentLines.shipmentId })
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
    return { ...row, orderNo, at: new Date(at) };
  }

  /** 한 트랜잭션 안에서는 예약 시각이 모두 같다 — 대기 순번을 주문 시각으로 맞춘다. */
  async function reserve(tx: DbTx, box: Box) {
    await wired.retryWorker.retryOne(box.lineId, tx);
    await tx
      .update(wmsTables.stockReservations)
      .set({ requestedAt: box.at })
      .where(eq(wmsTables.stockReservations.shipmentLineId, box.lineId));
  }

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

  const sessionIdOf = (complete: { sessionId: string }) => complete.sessionId;

  const availability = (tx: DbTx, world: World) => readWarehouseAvailability(tx, world.skuId, world.warehouseId);

  async function count(tx: DbTx, world: World, counted: number) {
    const session = await stocktaking.createSession({ warehouseId: world.warehouseId, sessionName: 'count' }, tx);
    await stocktaking.startSession(session.id, tx);
    const key = () => ({ contractVersion: 2 as const, idempotencyKey: randomUUID() });
    await stocktaking.scanLocation({ sessionId: session.id, locationBarcode: world.shelf.code, ...key() }, tx);
    await stocktaking.scanProduct(
      { sessionId: session.id, locationId: world.shelf.id, productBarcode: world.barcode, quantity: counted, ...key() },
      tx,
    );
    const preview = await stocktaking.generateAdjustments(session.id, { contractVersion: 2 }, tx);
    const complete = Object.assign(
      () => stocktaking.completeSession(session.id, tx, { ...key(), previewToken: preview.previewToken }),
      { sessionId: session.id },
    );
    return { preview, complete };
  }

  it('실물이 모자라면 넘친 예약을 뒤에 온 주문부터 놓고, 상자·재고·예약이 실물에 맞는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 10);
      const early = await addOrder(tx, world, 4, '2026-01-01T00:00:00Z');
      const late = await addOrder(tx, world, 6, '2026-01-02T00:00:00Z');
      await reserve(tx, early);
      await reserve(tx, late);

      const { preview, complete } = await count(tx, world, 3);
      expect(preview.reservationImpact).toEqual([
        { skuId: world.skuId, orderCount: 2, quantity: 7, missingQty: 0, heldBy: [] },
      ]);

      const result = await complete();

      expect(result.reservationImpact).toEqual(preview.reservationImpact);
      expect(await availability(tx, world)).toEqual({ onHand: 3, reserved: 3, available: 0 });
      expect(await boxOf(tx, early)).toEqual({ box: 3, confirmed: 3 });
      expect(await boxOf(tx, late)).toEqual({ box: 0, confirmed: 0 });
      // 재시도 워커가 다시 돌아도 없는 재고를 잡지 않는다
      await reserve(tx, late);
      expect(await boxOf(tx, late)).toEqual({ box: 0, confirmed: 0 });
    });
  });

  it('출고 준비에 들어간 상자가 잡은 몫은 놓지 않고도 완료하며, 그 주문을 알려 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 5);
      const planned = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      const draft = await addOrder(tx, world, 2, '2026-01-02T00:00:00Z');
      await reserve(tx, planned);
      await reserve(tx, draft);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));

      const { preview, complete } = await count(tx, world, 1);
      const impact = [
        {
          skuId: world.skuId,
          orderCount: 1,
          quantity: 2,
          missingQty: 2,
          heldBy: [{ orderNo: planned.orderNo, quantity: 3 }],
        },
      ];
      expect(preview.reservationImpact).toEqual(impact);

      const result = await complete();

      expect(result.reservationImpact).toEqual(impact);
      expect(await availability(tx, world)).toEqual({ onHand: 1, reserved: 3, available: -2 });
      expect(await boxOf(tx, draft)).toEqual({ box: 0, confirmed: 0 });
      expect(await boxOf(tx, planned)).toEqual({ box: 3, confirmed: 3 });
    });
  });

  it('실물이 더 많거나 다른 자리 재고로 예약이 감당되면 예약을 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 5);
      const [other] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: world.warehouseId, code: `OTHER-${randomUUID()}`, locationType: 'zone' })
        .returning();
      await stock(tx, { warehouseId: world.warehouseId, skuId: world.skuId, locationId: other.id }, 10);
      const box = await addOrder(tx, world, 6, '2026-01-01T00:00:00Z');
      await reserve(tx, box);

      const { preview, complete } = await count(tx, world, 1);
      expect(preview.reservationImpact).toEqual([]);
      const result = await complete();

      expect(result.reservationImpact).toEqual([]);
      expect(await availability(tx, world)).toEqual({ onHand: 11, reserved: 6, available: 5 });
      expect(await boxOf(tx, box)).toEqual({ box: 6, confirmed: 6 });
    });
  });

  // 같은 트랜잭션 안에서 «끼어든 예약»을 흉내 낸다. 연결 여럿의 실제 경합은 따로 잰다.
  it('예약을 놓은 뒤 재고를 잠그기 전에 다른 예약이 끼어든 것을 잠근 뒤 알아채면 완료를 되돌린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 5);
      const held = await addOrder(tx, world, 3, '2026-01-01T00:00:00Z');
      const waiting = await addOrder(tx, world, 2, '2026-01-02T00:00:00Z');
      await reserve(tx, held);
      const { complete } = await count(tx, world, 3);
      const original = wiring.reservations.releaseAvailable.bind(wiring.reservations);
      const spy = jest.spyOn(wiring.reservations, 'releaseAvailable').mockImplementation(async (...args) => {
        const released = await original(...args);
        await reserve(tx, waiting);
        return released;
      });

      await expect(tx.transaction(() => complete())).rejects.toMatchObject({
        response: { code: 'STOCKTAKING_PREVIEW_STALE' },
      });
      spy.mockRestore();

      // 실사는 반영되지 않았고 끼어든 예약은 그대로다
      expect(await availability(tx, world)).toEqual({ onHand: 5, reserved: 5, available: 0 });

      // 다시 검토하고 완료하면 끼어든 예약까지 놓고 끝난다
      const again = await stocktaking.generateAdjustments(sessionIdOf(complete), { contractVersion: 2 }, tx);
      expect(again.reservationImpact).toEqual([
        { skuId: world.skuId, orderCount: 1, quantity: 2, missingQty: 0, heldBy: [] },
      ]);
      await stocktaking.completeSession(sessionIdOf(complete), tx, {
        contractVersion: 2,
        idempotencyKey: randomUUID(),
        previewToken: again.previewToken,
      });
      expect(await availability(tx, world)).toEqual({ onHand: 3, reserved: 3, available: 0 });
      expect(await boxOf(tx, waiting)).toEqual({ box: 0, confirmed: 0 });
    });
  });
});
