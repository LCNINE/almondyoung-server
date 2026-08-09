import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('stocktaking scan-product concurrency (DB integration, commit-type)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

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

  async function cleanup(ids: {
    sessionId: string;
    skuId: string;
    holderId: string;
    warehouseId: string;
    locationId: string;
  }) {
    await db.delete(wmsTables.stocktakingLines).where(eq(wmsTables.stocktakingLines.sessionId, ids.sessionId));
    await db.delete(wmsTables.stocktakingSessions).where(eq(wmsTables.stocktakingSessions.id, ids.sessionId));
    await db.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, ids.skuId));
    await db.delete(wmsTables.locations).where(eq(wmsTables.locations.id, ids.locationId));
    await db.delete(wmsTables.skus).where(eq(wmsTables.skus.id, ids.skuId));
    await db.delete(wmsTables.holders).where(eq(wmsTables.holders.id, ids.holderId));
    await db.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouseId));
  }

  it('같은 라인에 대한 동시 scanProduct 호출 두 건이 모두 반영된다 (lost update 없음)', async () => {
    const { warehouse, holder, sku, barcode, loc, session } = await seed();
    try {
      // 먼저 한 번 스캔해서 라인을 만들어 둔다 — 두 번째 스캔부터가 "동시" 경합이다.
      const first = await svc.scanProduct({
        sessionId: session.id,
        locationId: loc.id,
        productBarcode: barcode,
        quantity: 1,
      });
      expect(first.countedQuantity).toBe(1);

      // 완전히 동시에 두 개의 독립 트랜잭션(별도 커넥션)에서 같은 라인을 증가시킨다.
      const [a, b] = await Promise.all([
        svc.scanProduct({ sessionId: session.id, locationId: loc.id, productBarcode: barcode, quantity: 1 }),
        svc.scanProduct({ sessionId: session.id, locationId: loc.id, productBarcode: barcode, quantity: 1 }),
      ]);

      const [line] = await db
        .select({ countedQuantity: wmsTables.stocktakingLines.countedQuantity })
        .from(wmsTables.stocktakingLines)
        .where(eq(wmsTables.stocktakingLines.id, first.lineId));

      // 1(사전 스캔) + 1 + 1 = 3 이어야 한다. lost update 가 있으면 2로 관측된다.
      expect(line?.countedQuantity).toBe(3);
      // 두 동시 호출은 서로 다른 값(2, 3)을 순서대로 관측해야 한다 — 둘 다 같은
      // 값을 돌려주면(예: 둘 다 2) 한쪽이 다른 쪽의 갱신을 덮어쓴 것이다.
      expect(new Set([a.countedQuantity, b.countedQuantity])).toEqual(new Set([2, 3]));
    } finally {
      await cleanup({
        sessionId: session.id,
        skuId: sku.id,
        holderId: holder.id,
        warehouseId: warehouse.id,
        locationId: loc.id,
      });
    }
  });
});
