import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';
import { ExpectedArrivalsReader } from './expected-arrivals.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('ExpectedArrivalsReader — 선적 opt-in (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof wmsSchema>>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (trx: DbTx) => Promise<void>): Promise<void> {
    await db
      .transaction(async (trx) => {
        await fn(trx as unknown as DbTx);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  function readerOn(trx: DbTx): ExpectedArrivalsReader {
    const dbService = {
      db: trx,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new ExpectedArrivalsReader(new PurchaseOrderExpectedArrivalReader(dbService), dbService);
  }

  async function warehouse(trx: DbTx) {
    const [w] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `ea-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    return w.id;
  }

  async function sku(trx: DbTx) {
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `ea-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [s] = await trx
      .insert(wmsTables.skus)
      .values({ name: 'ea-sku', code: `EA-${randomUUID().toUpperCase()}`.slice(0, 40), holderId: holder.id })
      .returning();
    return s.id;
  }

  /** 상자 둘(입고용 하나는 이미 확정 가능) + sku 줄 하나. counted > 0 이면 그만큼 센 것으로 친다. */
  async function seedShipment(
    trx: DbTx,
    warehouseId: string,
    opts: { expectedQty: number; countedQty?: number; expectedArrival?: string | null; receivedBoxes?: number },
  ) {
    const [sh] = await trx
      .insert(wmsTables.inboundShipments)
      .values({
        warehouseId,
        status: 'expected',
        name: `ea-ship-${randomUUID().slice(0, 6)}`,
        expectedArrival: opts.expectedArrival ?? null,
      })
      .returning();
    const skuId = await sku(trx);
    const [line] = await trx
      .insert(wmsTables.inboundShipmentLines)
      .values({ shipmentId: sh.id, rowNumber: 1, raw: {} as never, kind: 'sku', skuId, expectedQty: opts.expectedQty })
      .returning();
    const boxIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const [b] = await trx
        .insert(wmsTables.inboundShipmentBoxes)
        .values({
          shipmentId: sh.id,
          label: `B${i + 1}`,
          sortKey: i,
          origin: 'list',
          disposition: 'stock',
          status: i < (opts.receivedBoxes ?? 0) ? 'received' : 'open',
        })
        .returning();
      boxIds.push(b.id);
      await trx.insert(wmsTables.inboundShipmentLineBoxes).values({ lineId: line.id, boxId: b.id });
    }
    // 전달용 상자는 stockBoxes 에 세지 않는다
    await trx
      .insert(wmsTables.inboundShipmentBoxes)
      .values({ shipmentId: sh.id, label: 'F1', sortKey: 9, origin: 'list', disposition: 'forward', status: 'open' });
    if (opts.countedQty) {
      await trx
        .insert(wmsTables.inboundShipmentBoxCounts)
        .values({ lineId: line.id, boxId: boxIds[0], countedQty: opts.countedQty, countMethod: 'counted' });
    }
    return sh.id;
  }

  it('without include returns only purchase orders (unchanged shape)', async () => {
    await inRollback(async (trx) => {
      const w = await warehouse(trx);
      await seedShipment(trx, w, { expectedQty: 5 });
      const result = await readerOn(trx).listByWarehouse(w, { includeShipments: false }, trx);
      expect(result).toEqual({ warehouseId: w, totalDocuments: 0, totalOutstandingQuantity: 0, arrivals: [] });
    });
  });

  it('include=inbound_shipment adds open shipments with outstanding', async () => {
    await inRollback(async (trx) => {
      const w = await warehouse(trx);
      const late = await seedShipment(trx, w, { expectedQty: 10, countedQty: 4, expectedArrival: '2026-12-20' });
      const undated = await seedShipment(trx, w, { expectedQty: 3, expectedArrival: null, receivedBoxes: 1 });
      const early = await seedShipment(trx, w, { expectedQty: 7, expectedArrival: '2026-12-01' });
      const result = await readerOn(trx).listByWarehouse(w, { includeShipments: true }, trx);
      expect(result.arrivals.map((a) => a.documentId)).toEqual([early, late, undated]);
      expect(result.totalDocuments).toBe(3);
      expect(result.totalOutstandingQuantity).toBe(7 + 6 + 3);
      expect(result.arrivals[1]).toMatchObject({
        source: 'inbound_shipment',
        expectedDate: '2026-12-20',
        totalOutstandingQuantity: 6,
        receivedBoxes: 0,
        stockBoxes: 2,
      });
      expect(result.arrivals[2]).toMatchObject({ receivedBoxes: 1, stockBoxes: 2 });
    });
  });

  it('fully received shipment is not listed', async () => {
    await inRollback(async (trx) => {
      const w = await warehouse(trx);
      await seedShipment(trx, w, { expectedQty: 4, countedQty: 4 });
      const result = await readerOn(trx).listByWarehouse(w, { includeShipments: true }, trx);
      expect(result.arrivals).toEqual([]);
    });
  });

  it('other warehouse shipment is not listed', async () => {
    await inRollback(async (trx) => {
      const w = await warehouse(trx);
      const other = await warehouse(trx);
      await seedShipment(trx, other, { expectedQty: 4 });
      const result = await readerOn(trx).listByWarehouse(w, { includeShipments: true }, trx);
      expect(result.arrivals).toEqual([]);
    });
  });
});
