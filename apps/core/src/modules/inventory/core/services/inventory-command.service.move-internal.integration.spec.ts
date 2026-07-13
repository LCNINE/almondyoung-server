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
 * 창고내 로케이션 이동(moveInternal, MOVE) 보존 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- inventory-command.service.move-internal.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('InventoryCommandService.moveInternal 창고내 이동 보존 (DB integration, rollback-only)', () => {
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

  // 같은 warehouse 안 로케이션 A/B 를 만들고 A 에 onHand 를 세팅.
  async function seedTwoLocations(tx: DbTx, onHand: number) {
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
    const [locA] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-A-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    const [locB] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wh.id, code: `IT-B-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: locA.id, quantity: onHand }, tx);
    return { wh, sku, locA, locB };
  }

  async function onHandAtLocation(tx: DbTx, skuId: string, locationId: string): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('로케이션 A→B 이동 후 로케이션별 수량이 이동하고 창고 합은 불변', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, locA, locB } = await seedTwoLocations(tx, 100);

      await command.moveInternal(
        { skuId: sku.id, warehouseId: wh.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 },
        tx,
      );

      const a = await onHandAtLocation(tx, sku.id, locA.id);
      const b = await onHandAtLocation(tx, sku.id, locB.id);
      expect(a).toBe(60);
      expect(b).toBe(40);
      expect(a + b).toBe(100); // 창고 합 불변

      // MOVE 이벤트 1건 기록
      const events = await tx
        .select({ quantity: wmsTables.stockEvents.quantity })
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, sku.id), eq(wmsTables.stockEvents.transitionType, 'MOVE')));
      expect(events).toHaveLength(1);
      expect(events[0].quantity).toBe(40);
    });
  });
});
