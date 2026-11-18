import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  consolidationBase,
  ConsolidationBase,
  createConsolidationSource,
  inRollbackTx,
  makeDb,
  makeDbService,
  wireLogistics,
  Wired,
} from './__support__';
import { markOrderLinesAsExchange, seedHandedOverOrder } from './__support__/sellmate-handed-over-fixtures';
import { loadSellmateShipmentIds } from './sellmate-handed-over-shipments';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('loadSellmateShipmentIds (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

    ({ sql: client, db } = makeDb(DATABASE_URL));
    wired = wireLogistics(makeDbService(db), 'v2');
  });

  afterAll(async () => {
    await client.end();
  });

  const source = (tx: DbTx, base: ConsolidationBase) =>
    createConsolidationSource(tx, wired, base, { quantity: 1, customerId: randomUUID() });

  it('넘긴 판매주문의 상자만 셀메이트 상자다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const handed = await source(tx, base);
      const other = await source(tx, base);

      await seedHandedOverOrder(tx, handed.salesOrderId);

      expect(await loadSellmateShipmentIds(tx, [handed.shipment.id, other.shipment.id])).toEqual(
        new Set([handed.shipment.id]),
      );
    });
  });

  it('교환 줄만 든 상자는 셀메이트 상자가 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const handed = await source(tx, base);

      await seedHandedOverOrder(tx, handed.salesOrderId);
      await markOrderLinesAsExchange(tx, handed.salesOrderId);

      expect((await loadSellmateShipmentIds(tx, [handed.shipment.id])).size).toBe(0);
    });
  });

  it('셀메이트 줄과 앱 줄이 섞인 상자는 셀메이트 상자다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const handed = await source(tx, base);
      const other = await source(tx, base);

      await seedHandedOverOrder(tx, handed.salesOrderId);
      await tx
        .update(wmsTables.shipmentLines)
        .set({ shipmentId: other.shipment.id })
        .where(eq(wmsTables.shipmentLines.id, handed.line.id));

      expect(await loadSellmateShipmentIds(tx, [other.shipment.id])).toEqual(new Set([other.shipment.id]));
    });
  });

  it('판매주문 줄 참조가 빈 줄도 넘긴 주문이면 셀메이트 줄이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await consolidationBase(tx);
      const handed = await source(tx, base);

      await seedHandedOverOrder(tx, handed.salesOrderId);
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ salesOrderLineId: null })
        .where(eq(wmsTables.fulfillmentOrderItems.id, handed.fulfillmentOrderItemId));

      expect(await loadSellmateShipmentIds(tx, [handed.shipment.id])).toEqual(new Set([handed.shipment.id]));
    });
  });

  it('빈 목록이면 빈 집합', async () => {
    await inRollbackTx(db, async (tx) => {
      expect((await loadSellmateShipmentIds(tx, [])).size).toBe(0);
    });
  });
});
