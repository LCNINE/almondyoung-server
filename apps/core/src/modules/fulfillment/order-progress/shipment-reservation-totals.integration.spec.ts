import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { shipmentReservationTotalsSql } from './shipment-reservation-totals.sql';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

type Totals = { shipment_id: string; line_qty: number; reserved_qty: number; unreserved_qty: number };

describeIfDb('shipmentReservationTotalsSql (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function rollback(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  it('상자당 한 행 — 라인 수량 합과 확정 예약 합(라인에 예약이 여럿이어도 라인 수량을 곱하지 않는다)', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [5] });
      const args = { foId: fo.foId, foItemId: fo.foItemId, shipmentLineId: box.lineIds[0] };
      await f.seedConfirmedReservation(tx, w, { ...args, quantity: 1 });
      await f.seedConfirmedReservation(tx, w, { ...args, quantity: 2 });

      const scoped = (await tx.execute(
        shipmentReservationTotalsSql(sql`SELECT ${box.shipmentId}::uuid`),
      )) as unknown as Totals[];
      expect(scoped).toEqual([{ shipment_id: box.shipmentId, line_qty: 5, reserved_qty: 3, unreserved_qty: 2 }]);

      // 범위 인자가 없는 형태도 같은 값을 낸다
      const all = (await tx.execute(shipmentReservationTotalsSql())) as unknown as Totals[];
      expect(all.filter((r) => r.shipment_id === box.shipmentId)).toEqual(scoped);
    });
  });

  it('범위 목록에 같은 상자가 여럿 있어도 한 행이고, 예약 없는 상자는 0', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', qty: [2] });
      const rows = (await tx.execute(
        shipmentReservationTotalsSql(sql`SELECT ${box.shipmentId}::uuid UNION ALL SELECT ${box.shipmentId}::uuid`),
      )) as unknown as Totals[];
      expect(rows).toEqual([{ shipment_id: box.shipmentId, line_qty: 2, reserved_qty: 0, unreserved_qty: 2 }]);
    });
  });

  it('unreserved_qty 는 라인별로 0 밑을 자른다 — 넘치게 예약된 라인이 모자란 라인을 가리지 않는다', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const [second] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fo.foId,
          salesOrderId: o.salesOrderId,
          salesOrderLineId: o.lineId,
          skuId: w.skuId,
          qty: 1,
        })
        .returning();
      const box = await f.seedBox(tx, w, [fo.foItemId, second.id], { status: 'draft', qty: [1, 1] });
      await f.seedConfirmedReservation(tx, w, {
        foId: fo.foId,
        foItemId: fo.foItemId,
        shipmentLineId: box.lineIds[0],
        quantity: 2,
      });
      const rows = (await tx.execute(
        shipmentReservationTotalsSql(sql`SELECT ${box.shipmentId}::uuid`),
      )) as unknown as Totals[];
      // 상자 합은 2 vs 2 로 «다 예약»처럼 보이지만 라인 B 는 1 이 비었다
      expect(rows).toEqual([{ shipment_id: box.shipmentId, line_qty: 2, reserved_qty: 2, unreserved_qty: 1 }]);
    });
  });

  // 입점사 상자는 창고 흐름에 들어가지 않아 예약이 없다 — «덜 예약»이 아니다(K3 PR4, N5). 라인 수량·예약 합은 그대로 센다
  it('입점사 상자는 unreserved_qty 0 — line_qty 는 그대로, 예약은 없다', async () => {
    await rollback(async (tx) => {
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], {
        status: 'draft',
        qty: [3],
        supplierId: await f.seedDirectSupplier(tx),
      });
      const rows = (await tx.execute(
        shipmentReservationTotalsSql(sql`SELECT ${box.shipmentId}::uuid`),
      )) as unknown as Totals[];
      expect(rows).toEqual([{ shipment_id: box.shipmentId, line_qty: 3, reserved_qty: 0, unreserved_qty: 0 }]);
      const all = (await tx.execute(shipmentReservationTotalsSql())) as unknown as Totals[];
      expect(all.filter((r) => r.shipment_id === box.shipmentId)).toEqual(rows);
    });
  });
});
