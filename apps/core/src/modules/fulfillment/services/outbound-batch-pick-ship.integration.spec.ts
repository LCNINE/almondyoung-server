import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedSalesOrder,
  seedMatching,
  seedInvoiceIssued,
  receiveStock,
  onHand,
  availableFromView,
  assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('출고작업·피킹·검수·개별출고 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  // ready FO 하나(onHand 100, qty 10, 예약 confirmed)를 create 경로로 만든다.
  async function seedReadyFo(tx: DbTx) {
    const variantId = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId, skuCode } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 10 }] });
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    await w.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [fo] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    expect(fo.status).toBe('ready');
    const [foi] = await tx
      .select({ id: wmsTables.fulfillmentOrderItems.id })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    return { warehouseId, skuId, skuCode, foId: fo.id, foiId: foi.id };
  }

  async function foStatus(tx: DbTx, foId: string) {
    const [r] = await tx
      .select({ s: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, foId));
    return r?.s;
  }

  it('3a·3b·3c) 배치→피킹→완료→송장→박스오픈→검수→개별출고 종단, 수량·상태·I5 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedReadyFo(tx);
      const operatorId = randomUUID();

      // 3a) 배치: ready FO 를 개별피킹 배치에 편입 → allocated.
      const { batchId } = await w.outboundBatch.createBatch(
        { warehouseId: f.warehouseId, pickingMethod: 'individual' },
        tx,
      );
      await w.outboundBatch.addFulfillmentOrdersToBatch(batchId, [f.foId], tx);
      expect(await foStatus(tx, f.foId)).toBe('allocated');
      const [batch] = await tx
        .select({
          status: wmsTables.outboundBatches.status,
          totalQty: wmsTables.outboundBatches.totalQty,
          totalItems: wmsTables.outboundBatches.totalItems,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId));
      expect(batch).toMatchObject({ status: 'created', totalItems: 1, totalQty: 10 });

      // 3b) 피킹.
      await w.outboundBatch.startPicking(batchId, tx);
      expect(await foStatus(tx, f.foId)).toBe('picking');
      await w.picking.pickItem({ batchId, skuId: f.skuId, pickedQty: 10, pickerUserId: operatorId }, tx);
      const [foiPicked] = await tx
        .select({ picked: wmsTables.fulfillmentOrderItems.pickedQty })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foiPicked.picked).toBe(10);
      await w.outboundBatch.completeBatch(batchId, tx);
      expect(await foStatus(tx, f.foId)).toBe('picked');

      // 3c) 송장(우회 seed) + FO invoiced → 박스오픈 → 검수 → 자동 소진.
      const { trackingNo } = await seedInvoiceIssued(tx, { fulfillmentOrderId: f.foId });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'invoiced' })
        .where(eq(wmsTables.fulfillmentOrders.id, f.foId));

      const availBefore = await availableFromView(tx, f.skuId, f.warehouseId); // 100-10=90
      expect(availBefore).toBe(90);

      const { shipmentId } = await w.shipment.openBoxByScan(trackingNo, operatorId, tx);
      await w.shipment.inspectScan(shipmentId, f.skuCode, 10, operatorId, tx); // 전량 검수 → consume 자동발사

      // 종단 상태.
      expect(await foStatus(tx, f.foId)).toBe('shipped');
      const [ship] = await tx
        .select({ s: wmsTables.shipments.status })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId));
      expect(ship.s).toBe('shipped');
      const [foiShipped] = await tx
        .select({ shipped: wmsTables.fulfillmentOrderItems.shippedQty, status: wmsTables.fulfillmentOrderItems.status })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foiId));
      expect(foiShipped).toMatchObject({ shipped: 10, status: 'shipped' });

      // I4: 검수 라인 inspectedQty == qty.
      const [line] = await tx
        .select({ inspected: wmsTables.shipmentLines.inspectedQty, qty: wmsTables.shipmentLines.qty })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
      expect(line.inspected).toBe(line.qty);

      // I5: 출고 후 onHand 10 감소·available 불변.
      expect(await onHand(tx, f.skuId, f.warehouseId)).toBe(90);
      expect(await availableFromView(tx, f.skuId, f.warehouseId)).toBe(availBefore); // 90 → 불변
      // SHIP 1건.
      const ships = await tx
        .select({ q: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, f.skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
      expect(ships).toEqual([{ q: 10 }]);
      // I6: received(100) == onHand(90) + shipped(10).
      await assertConservation(tx, { skuId: f.skuId, warehouseId: f.warehouseId, received: 100, shipped: 10 });
    });
  });
});
