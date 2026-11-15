import { sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from './inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
} from '../../fulfillment/services/__support__';

/**
 * 선적 입고 문서 테이블의 CHECK·unique 가 실제로 DB 에서 막는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-shipment-schema
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// 실패한 문장은 트랜잭션을 25P02 로 중단시키므로 savepoint(중첩 트랜잭션) 안에서 시도한다.
async function expectSqlState(tx: DbTx, run: (sp: DbTx) => PromiseLike<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await tx.transaction(async (sp) => {
      await run(sp as unknown as DbTx);
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const err = caught as Error & { cause?: { code?: string }; code?: string };
  expect(err.cause?.code ?? err.code).toBe(code);
}

describeIfDb('inbound shipment schema', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedShipment(tx: DbTx) {
    const wh = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [shipment] = await tx
      .insert(wmsTables.inboundShipments)
      .values({ warehouseId: wh.warehouseId, name: 'S' })
      .returning();
    return { warehouseId: wh.warehouseId, skuId, shipmentId: shipment.id };
  }

  const lineBase = (shipmentId: string) => ({ shipmentId, rowNumber: 2, raw: {} });

  it('sku line requires sku_id', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId } = await seedShipment(trx);
      await expectSqlState(
        trx,
        (sp) =>
          sp
            .insert(wmsTables.inboundShipmentLines)
            .values({ ...lineBase(shipmentId), kind: 'sku', skuId: null, expectedQty: 1 }),
        '23514',
      );
    });
  });

  it('free line requires positive expected_qty', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId } = await seedShipment(trx);
      await expectSqlState(
        trx,
        (sp) =>
          sp.insert(wmsTables.inboundShipmentLines).values({ ...lineBase(shipmentId), kind: 'free', expectedQty: 0 }),
        '23514',
      );
    });
  });

  it('unresolved line may omit expected_qty', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId } = await seedShipment(trx);
      const rows = await trx
        .insert(wmsTables.inboundShipmentLines)
        .values({ ...lineBase(shipmentId), kind: 'unresolved', expectedQty: null })
        .returning();
      expect(rows[0].issues).toEqual([]);
    });
  });

  it('forward box cannot be received', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId } = await seedShipment(trx);
      await expectSqlState(
        trx,
        (sp) =>
          sp
            .insert(wmsTables.inboundShipmentBoxes)
            .values({
              shipmentId,
              label: 'L1',
              sortKey: 1,
              origin: 'list',
              disposition: 'forward',
              status: 'received',
            }),
        '23514',
      );
    });
  });

  it('box label unique per shipment', async () => {
    await inRollbackTx(db, async (trx) => {
      const a = await seedShipment(trx);
      const b = await seedShipment(trx);
      const box = (shipmentId: string) => ({ shipmentId, label: 'L5', sortKey: 1, origin: 'list' as const });
      await trx.insert(wmsTables.inboundShipmentBoxes).values(box(a.shipmentId));
      await trx.insert(wmsTables.inboundShipmentBoxes).values(box(b.shipmentId));
      await expectSqlState(trx, (sp) => sp.insert(wmsTables.inboundShipmentBoxes).values(box(a.shipmentId)), '23505');
    });
  });

  it('one live count per line per box', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId, skuId } = await seedShipment(trx);
      const [box] = await trx
        .insert(wmsTables.inboundShipmentBoxes)
        .values({ shipmentId, label: 'L1', sortKey: 1, origin: 'list' })
        .returning();
      const [line] = await trx
        .insert(wmsTables.inboundShipmentLines)
        .values({ ...lineBase(shipmentId), kind: 'sku', skuId, expectedQty: 3 })
        .returning();
      const [first] = await trx
        .insert(wmsTables.inboundShipmentBoxCounts)
        .values({ boxId: box.id, lineId: line.id, skuId, countedQty: 3 })
        .returning();
      await expectSqlState(
        trx,
        (sp) =>
          sp
            .insert(wmsTables.inboundShipmentBoxCounts)
            .values({ boxId: box.id, lineId: line.id, skuId, countedQty: 2 }),
        '23505',
      );
      await trx.execute(sql`UPDATE inbound_shipment_box_counts SET canceled_at = now() WHERE id = ${first.id}`);
      await trx
        .insert(wmsTables.inboundShipmentBoxCounts)
        .values({ boxId: box.id, lineId: line.id, skuId, countedQty: 2 });
    });
  });

  it('unplanned count needs sku and positive qty', async () => {
    await inRollbackTx(db, async (trx) => {
      const { shipmentId, skuId } = await seedShipment(trx);
      const [box] = await trx
        .insert(wmsTables.inboundShipmentBoxes)
        .values({ shipmentId, label: 'L1', sortKey: 1, origin: 'list' })
        .returning();
      await expectSqlState(
        trx,
        (sp) =>
          sp
            .insert(wmsTables.inboundShipmentBoxCounts)
            .values({ boxId: box.id, lineId: null, skuId: null, countedQty: 1 }),
        '23514',
      );
      await expectSqlState(
        trx,
        (sp) =>
          sp.insert(wmsTables.inboundShipmentBoxCounts).values({ boxId: box.id, lineId: null, skuId, countedQty: 0 }),
        '23514',
      );
    });
  });
});
