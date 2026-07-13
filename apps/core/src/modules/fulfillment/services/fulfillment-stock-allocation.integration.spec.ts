import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
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
  receiveStock,
  assertStockConsistent,
  assertFoReservationAgg,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FO 재고 할당·재시도 (DB integration, rollback-only)', () => {
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

  // 매칭된 SO 하나를 만들고 onHand 를 세팅. FO 는 만들지 않음(케이스에서 create).
  async function background(tx: DbTx, opts: { onHand: number; soQty: number }) {
    const variantId = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    if (opts.onHand > 0) await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: opts.onHand });
    const { salesOrderId } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: opts.soQty }] });
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    return { warehouseId, locationId, skuId, salesOrderId };
  }

  async function foBySo(tx: DbTx, salesOrderId: string) {
    const [row] = await tx
      .select({
        id: wmsTables.fulfillmentOrders.id,
        status: wmsTables.fulfillmentOrders.status,
        totalReservedQty: wmsTables.fulfillmentOrders.totalReservedQty,
        reservationFailureReason: wmsTables.fulfillmentOrders.reservationFailureReason,
        reservationFailureDetails: wmsTables.fulfillmentOrders.reservationFailureDetails,
      })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    return row;
  }

  it('2a) 재고 충분 → FO ready, 예약 정합(I2·I3), onHand 는 예약으로 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 100, soQty: 40 });

      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);

      expect(fo.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 100, reserved: 40 });
      await assertFoReservationAgg(tx, fo.id);
    });
  });

  it('2b) 재고 부족 → FO unfulfillable + failureDetails 숫자 정확, 예약 0건', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 1, soQty: 3 });

      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);

      expect(fo.status).toBe('unfulfillable');
      expect(fo.reservationFailureReason).toBe('RESERVATION_FAILED');
      const details = fo.reservationFailureDetails as {
        failedItems: Array<{ requiredQty: number; availableQty: number }>;
      };
      const failed = details.failedItems[0];
      expect(failed).toMatchObject({ requiredQty: 3, availableQty: 1 });
      // all-or-nothing: 부분예약 없음.
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 1, reserved: 0 });
    });
  });

  it('2c) 부족→보충→retryOne → FO ready, 예약 채워짐', async () => {
    await inRollbackTx(db, async (tx) => {
      const bg = await background(tx, { onHand: 1, soQty: 3 });
      await w.fulfillments.create({ salesOrderId: bg.salesOrderId, warehouseId: bg.warehouseId }, tx);
      const fo = await foBySo(tx, bg.salesOrderId);
      expect(fo.status).toBe('unfulfillable');

      // 보충 +5 → onHand 6.
      await receiveStock(w.command, tx, {
        skuId: bg.skuId,
        warehouseId: bg.warehouseId,
        locationId: bg.locationId,
        quantity: 5,
      });

      // 재시도 워커 내부 메서드 직접 호출(크론 우회).
      const candidates = await w.retryWorker.findCandidates(50, tx);
      expect(candidates.map((c) => c.id)).toContain(fo.id);
      await w.retryWorker.retryOne(fo.id, tx);

      const after = await foBySo(tx, bg.salesOrderId);
      expect(after.status).toBe('ready');
      await assertStockConsistent(tx, { skuId: bg.skuId, warehouseId: bg.warehouseId, onHand: 6, reserved: 3 });
      await assertFoReservationAgg(tx, fo.id);
    });
  });
});
