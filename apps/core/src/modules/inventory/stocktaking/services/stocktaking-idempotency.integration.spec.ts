import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingController } from '../controllers/stocktaking.controller';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('stocktaking v2 idempotency (DB integration, commit-type)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;
  let controller: StocktakingController;

  beforeAll(() => {
    // 실제 동시 트랜잭션(별도 커넥션 두 개 이상)을 재현해야 한다 — 다른 stocktaking
    // 스펙들의 max:1·rollback-only 패턴으로는 이 동시성 버그가 재현되지 않는다.
    sql = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
    controller = new StocktakingController(svc, new InventoryIdempotencyService(dbService));
  });

  afterAll(async () => {
    await sql.end();
  });

  async function seed() {
    const [warehouse] = await db
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await db
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await db
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const barcode = `BC-${randomUUID().slice(0, 12)}`;
    await db.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [loc] = await db
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    const [session] = await db
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it-concurrency', status: 'in_progress' })
      .returning();
    return { warehouse, holder, sku, barcode, loc, session };
  }

  it('same v2 key concurrently counts once; a different key counts a second item', async () => {
    const { barcode, loc, session } = await seed();
    const dto = {
      contractVersion: 2,
      idempotencyKey: randomUUID(),
      sessionId: session.id,
      locationId: loc.id,
      productBarcode: barcode,
      quantity: 1,
    };
    const call = controller.scanProduct.bind(controller) as (...args: unknown[]) => Promise<any>;
    const actor = { id: '00000000-0000-4000-8000-000000000001' };
    const [a, b] = await Promise.all([call(dto, actor), call(dto, actor)]);
    expect(a.countedQuantity).toBe(1);
    expect(b.countedQuantity).toBe(1);
    const next = await call({ ...dto, idempotencyKey: randomUUID() }, actor);
    expect(next.countedQuantity).toBe(2);
    const [line] = await db
      .select()
      .from(wmsTables.stocktakingLines)
      .where(eq(wmsTables.stocktakingLines.id, a.lineId));
    expect(line.countedQuantity).toBe(2);
  });
  it('replays scan/count/complete responses after completion without changing the ledger twice', async () => {
    const { barcode, loc, session, sku } = await seed();
    const actor = { id: randomUUID() };
    const scan = {
      contractVersion: 2,
      idempotencyKey: randomUUID(),
      sessionId: session.id,
      locationId: loc.id,
      productBarcode: barcode,
      quantity: 1,
    };
    const scanResult = await controller.scanProduct(scan, actor);
    const count = {
      contractVersion: 2,
      idempotencyKey: randomUUID(),
      countedQuantity: 3,
      expectedRevision: scanResult.lineRevision,
    };
    const countResult = await controller.updateCount(scanResult.lineId, count, actor);
    const review = await svc.generateAdjustments(session.id, { contractVersion: 2 });
    const complete = { contractVersion: 2, idempotencyKey: randomUUID(), previewToken: review.previewToken };
    const result = await controller.completeSession(session.id, complete, actor);
    await expect(controller.completeSession(session.id, complete, actor)).resolves.toEqual(
      JSON.parse(JSON.stringify(result)),
    );
    await expect(controller.scanProduct(scan, actor)).resolves.toEqual(scanResult);
    await expect(controller.updateCount(scanResult.lineId, count, actor)).resolves.toEqual(countResult);
    await expect(
      controller.completeSession(session.id, { ...complete, idempotencyKey: randomUUID() }, actor),
    ).rejects.toThrow();
    const events = await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, sku.id));
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe(3);
  });
});
