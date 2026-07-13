import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { InventoryCommandService } from './inventory-command.service';

/**
 * 입고(receive, RECEIVE) 무손실 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- inventory-command.service.receive.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('InventoryCommandService.receive 입고 무손실 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;

    const invOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
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

  async function seedBase(tx: DbTx) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    return { wh, sku, loc };
  }

  async function onHandQty(tx: DbTx, skuId: string, warehouseId: string, locationId: string): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('receive N 은 ON_HAND +N 과 RECEIVE 이벤트 1건을 남긴다', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedBase(tx);

      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 30 }, tx);

      // 1) 원장 투영 ON_HAND == 30
      expect(await onHandQty(tx, sku.id, wh.id, loc.id)).toBe(30);

      // 2) RECEIVE 이벤트 정확히 1건, quantity == 30
      const events = await tx
        .select({ quantity: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, sku.id), eq(wmsTables.stockEvents.transitionType, 'RECEIVE')));
      expect(events).toHaveLength(1);
      expect(events[0].quantity).toBe(30);
    });
  });

  it('연속 입고는 ON_HAND 를 누적한다', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedBase(tx);
      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 30 }, tx);
      await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: 20 }, tx);
      expect(await onHandQty(tx, sku.id, wh.id, loc.id)).toBe(50);
    });
  });
});
