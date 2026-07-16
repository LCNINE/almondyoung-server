import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { StockEventStore } from './stock-event.store';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('StockEventStore stock-ledger version (PostgreSQL, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let eventStore: StockEventStore;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((inner) => fn(inner as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
    const sellable = {
      recalculateAndPublishForSku: jest.fn().mockResolvedValue(undefined),
    } as unknown as ProductSellableQuantityService;
    eventStore = new StockEventStore(dbService, sellable);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  it('starts at version 1 and increments on both conflict-upsert and decrement projections', async () => {
    await inRollbackTx(async (tx) => {
      const suffix = randomUUID();
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `ledger-version-wh-${suffix}` })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `ledger-version-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'ledger-version-sku', code: `LEDGER-VERSION-${suffix}`, holderId: holder.id })
        .returning();
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `LEDGER-VERSION-${suffix}`, locationType: 'zone' })
        .returning();

      const ledger = () =>
        tx
          .select({ qty: wmsTables.stockLedgers.qty, version: wmsTables.stockLedgers.version })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, sku.id),
              eq(wmsTables.stockLedgers.warehouseId, warehouse.id),
              eq(wmsTables.stockLedgers.locationId, location.id),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );

      await eventStore.createEvent(
        {
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          toLocationId: location.id,
          toState: 'ON_HAND',
          transitionType: 'RECEIVE',
          quantity: 5,
          occurredAt: new Date(),
        },
        tx,
      );
      await expect(ledger()).resolves.toEqual([{ qty: 5, version: 1 }]);

      await eventStore.createEvent(
        {
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          toLocationId: location.id,
          toState: 'ON_HAND',
          transitionType: 'RECEIVE',
          quantity: 2,
          occurredAt: new Date(),
        },
        tx,
      );
      await expect(ledger()).resolves.toEqual([{ qty: 7, version: 2 }]);

      await eventStore.createEvent(
        {
          skuId: sku.id,
          fromWarehouseId: warehouse.id,
          fromLocationId: location.id,
          fromState: 'ON_HAND',
          transitionType: 'SHIP',
          quantity: 3,
          occurredAt: new Date(),
        },
        tx,
      );
      await expect(ledger()).resolves.toEqual([{ qty: 4, version: 3 }]);
    });
  });
});
