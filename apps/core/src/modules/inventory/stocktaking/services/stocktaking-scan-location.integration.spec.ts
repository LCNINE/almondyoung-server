import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking scan-location response (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
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
    const barcode = `BC-${randomUUID().slice(0, 12)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      stockState: 'ON_HAND',
      qty: 6,
    });
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it', status: 'in_progress' })
      .returning();
    return { warehouse, sku, barcode, loc, session };
  }

  it('첫 스캔에서 lineId 와 미카운트 상태를 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session } = await seed(tx);

      const res = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);

      expect(res.expectedItems).toHaveLength(1);
      const item = res.expectedItems[0];
      expect(item.lineId).toEqual(expect.any(String));
      expect(item.expectedQuantity).toBe(6);
      expect(item.countedQuantity).toBeNull();
      expect(item.status).toBe('pending');
    });
  });

  it('재스캔 시 이미 센 수량을 그대로 돌려준다 (이어하기)', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session, barcode } = await seed(tx);

      await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      const first = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      await svc.scanProduct(
        {
          sessionId: session.id,
          locationId: first.locationId,
          productBarcode: barcode,
          quantity: 4,
        },
        tx,
      );

      const again = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);

      expect(again.expectedItems).toHaveLength(1);
      expect(again.expectedItems[0].countedQuantity).toBe(4);
      expect(again.expectedItems[0].status).toBe('counted');
    });
  });

  it('그 위치에서 만들어진 미기대 항목도 함께 반환한다 (상위집합)', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session } = await seed(tx);

      // 원장에 없는 별도 SKU + 바코드 → scanProduct 가 expectedQuantity 0 라인을 만든다
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `it-h2-${randomUUID().slice(0, 8)}` })
        .returning();
      const [extra] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'extra', code: `IT-X-${randomUUID()}`, holderId: holder.id })
        .returning();
      const extraBarcode = `BC-X-${randomUUID().slice(0, 10)}`;
      await tx.insert(wmsTables.skuBarcodes).values({ skuId: extra.id, barcode: extraBarcode });

      const first = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      await svc.scanProduct(
        {
          sessionId: session.id,
          locationId: first.locationId,
          productBarcode: extraBarcode,
          quantity: 2,
        },
        tx,
      );

      const again = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);

      expect(again.expectedItems).toHaveLength(2);
      const unexpected = again.expectedItems.find((i) => i.skuId === extra.id);
      expect(unexpected?.expectedQuantity).toBe(0);
      expect(unexpected?.countedQuantity).toBe(2);
    });
  });
});
