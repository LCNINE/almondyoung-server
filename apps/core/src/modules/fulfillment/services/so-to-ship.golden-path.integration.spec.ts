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
  assertStockConsistent,
  assertFoReservationAgg,
  assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SO→출고 골든패스 E2E (DB integration, rollback-only)', () => {
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

  async function foBySo(tx: DbTx, soId: string) {
    const [r] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, soId));
    return r;
  }
  async function backlogRow(tx: DbTx, soId: string) {
    const [r] = await tx
      .select({
        id: wmsTables.fulfillmentOrderCreationBacklogs.id,
        status: wmsTables.fulfillmentOrderCreationBacklogs.status,
      })
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, soId));
    return r;
  }
  async function shipFoViaBox(
    tx: DbTx,
    args: { foId: string; skuId: string; skuCode: string; qty: number; operatorId: string },
  ) {
    const { trackingNo } = await seedInvoiceIssued(tx, { fulfillmentOrderId: args.foId });
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ status: 'invoiced' })
      .where(eq(wmsTables.fulfillmentOrders.id, args.foId));
    const { shipmentId } = await w.shipment.openBoxByScan(trackingNo, args.operatorId, tx);
    await w.shipment.inspectScan(shipmentId, args.skuCode, args.qty, args.operatorId, tx);
  }

  it('t0~t7: 매칭·재고 분기 후 두 FO 모두 배치·피킹·검수·출고, 모든 숫자 정합', async () => {
    await inRollbackTx(db, async (tx) => {
      const operatorId = randomUUID();
      const V1 = randomUUID();
      const V2 = randomUUID();

      // 월드: 창고 W1, 로케이션 L1, SKU-A / SKU-B.
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const A = await seedSku(tx, holderId);
      const B = await seedSku(tx, holderId);

      // t0: receive A+10, B+1.
      await receiveStock(w.command, tx, { skuId: A.skuId, warehouseId, locationId, quantity: 10 });
      await receiveStock(w.command, tx, { skuId: B.skuId, warehouseId, locationId, quantity: 1 });
      await assertStockConsistent(tx, { skuId: A.skuId, warehouseId, onHand: 10, reserved: 0 });
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 1, reserved: 0 });

      // SO-1(V1→A, 5), SO-2(V2→B, 3).
      const so1 = await seedSalesOrder(tx, { lines: [{ variantId: V1, quantity: 5 }] });
      const so2 = await seedSalesOrder(tx, { lines: [{ variantId: V2, quantity: 3 }] });

      // t1: SO-1 사전매칭 + 변환+할당 → FO-1 ready, reserved A=5.
      await seedMatching(tx, { variantId: V1, skuId: A.skuId, quantity: 1 });
      await w.fulfillments.create({ salesOrderId: so1.salesOrderId, warehouseId }, tx);
      const fo1 = await foBySo(tx, so1.salesOrderId);
      expect(fo1.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: A.skuId, warehouseId, onHand: 10, reserved: 5 });
      await assertFoReservationAgg(tx, fo1.id);

      // t2: SO-2 변환 시도(매칭X) → throw → backlog awaiting_matching.
      await expect(w.fulfillments.create({ salesOrderId: so2.salesOrderId, warehouseId }, tx)).rejects.toThrow();
      await w.backlog.enqueueForSalesOrder(so2.salesOrderId, tx);
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'processing' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, so2.salesOrderId));
      await w.backlog.markAwaitingMatching(
        (await backlogRow(tx, so2.salesOrderId)).id,
        [{ salesOrderLineId: so2.lineIds[0], variantId: V2, reason: 'NO_PRODUCT_SKU_MATCHING' }],
        tx,
      );
      expect((await backlogRow(tx, so2.salesOrderId)).status).toBe('awaiting_matching');

      // t3: V2 매칭 → backlog pending, 재변환 → 재고부족(B=1 < 3) → FO-2 unfulfillable.
      await w.productSkuMapping.upsert(V2, { links: [{ skuId: B.skuId, quantity: 1 }] }, tx);
      expect((await backlogRow(tx, so2.salesOrderId)).status).toBe('pending');
      await w.fulfillments.create({ salesOrderId: so2.salesOrderId, warehouseId }, tx);
      const fo2 = await foBySo(tx, so2.salesOrderId);
      expect(fo2.status).toBe('unfulfillable');
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 1, reserved: 0 });

      // t4: receive B+5 → onHand 6.
      await receiveStock(w.command, tx, { skuId: B.skuId, warehouseId, locationId, quantity: 5 });
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 6, reserved: 0 });

      // t5: retryOne → FO-2 ready, reserved B=3.
      await w.retryWorker.retryOne(fo2.id, tx);
      expect((await foBySo(tx, so2.salesOrderId)).status).toBe('ready');
      await assertStockConsistent(tx, { skuId: B.skuId, warehouseId, onHand: 6, reserved: 3 });
      await assertFoReservationAgg(tx, fo2.id);

      // t6: 두 FO 를 한 배치로 → 피킹 → 완료.
      const { batchId } = await w.outboundBatch.createBatch({ warehouseId, pickingMethod: 'individual' }, tx);
      await w.outboundBatch.addFulfillmentOrdersToBatch(batchId, [fo1.id, fo2.id], tx);
      await w.outboundBatch.startPicking(batchId, tx);
      await w.picking.pickItem({ batchId, skuId: A.skuId, pickedQty: 5, pickerUserId: operatorId }, tx);
      await w.picking.pickItem({ batchId, skuId: B.skuId, pickedQty: 3, pickerUserId: operatorId }, tx);
      await w.outboundBatch.completeBatch(batchId, tx);

      // t6→t7: 개별출고 A, 그다음 B. 각 박스별 검수→소진. I5(가용 불변) 확인.
      const availA = await availableFromView(tx, A.skuId, warehouseId); // 5
      await shipFoViaBox(tx, { foId: fo1.id, skuId: A.skuId, skuCode: A.skuCode, qty: 5, operatorId });
      expect(await onHand(tx, A.skuId, warehouseId)).toBe(5);
      expect(await availableFromView(tx, A.skuId, warehouseId)).toBe(availA); // 5 불변

      const availB = await availableFromView(tx, B.skuId, warehouseId); // 3
      await shipFoViaBox(tx, { foId: fo2.id, skuId: B.skuId, skuCode: B.skuCode, qty: 3, operatorId });
      expect(await onHand(tx, B.skuId, warehouseId)).toBe(3);
      expect(await availableFromView(tx, B.skuId, warehouseId)).toBe(availB); // 3 불변

      // 끝: 물질보존 sweep (I6). SHIP 이벤트 각 1건.
      await assertConservation(tx, { skuId: A.skuId, warehouseId, received: 10, shipped: 5 });
      await assertConservation(tx, { skuId: B.skuId, warehouseId, received: 6, shipped: 3 });
      expect(await foBySo(tx, so1.salesOrderId).then((r) => r.status)).toBe('shipped');
      expect(await foBySo(tx, so2.salesOrderId).then((r) => r.status)).toBe('shipped');
      for (const skuId of [A.skuId, B.skuId]) {
        const ships = await tx
          .select({ q: wmsTables.stockEvents.quantity })
          .from(wmsTables.stockEvents)
          .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
        expect(ships).toHaveLength(1);
      }
    });
  });
});
