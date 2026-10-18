import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { shipmentReservationTotalsSql } from './shipment-reservation-totals.sql';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

type Totals = { shipment_id: string; line_qty: number; reserved_qty: number };

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
      expect(scoped).toEqual([{ shipment_id: box.shipmentId, line_qty: 5, reserved_qty: 3 }]);

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
      expect(rows).toEqual([{ shipment_id: box.shipmentId, line_qty: 2, reserved_qty: 0 }]);
    });
  });
});
