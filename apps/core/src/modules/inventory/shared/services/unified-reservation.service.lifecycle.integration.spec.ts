import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { LocationService } from '../../core/services/location.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { UnifiedReservationService } from './unified-reservation.service';

/**
 * 예약 생명주기(reserve→release) 원복 통합 검증. rollback 전용 트랜잭션.
 * 실행: npm run test:core:integration:local -- unified-reservation.service.lifecycle.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('UnifiedReservationService reserve→release 원복 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let reservation: UnifiedReservationService;

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
    reservation = new UnifiedReservationService(dbService, sellable);
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

  // ON_HAND onHand 를 세팅한 (sku, warehouse) 를 만든다.
  async function seedStock(tx: DbTx, onHand: number) {
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
    await command.receive({ skuId: sku.id, toWarehouseId: wh.id, toLocationId: loc.id, quantity: onHand }, tx);
    return { wh, sku, loc };
  }

  it('reserve 는 예약수량을 늘리고 release 는 0 으로 원복한다 (ON_HAND 불변)', async () => {
    await inRollbackTx(async (tx) => {
      const { wh, sku, loc } = await seedStock(tx, 100);

      const res = await reservation.reserveStock(
        { targetType: 'FULFILLMENT_ORDER', targetId: randomUUID(), skuId: sku.id, warehouseId: wh.id, quantity: 40 },
        tx,
      );
      expect(await reservation.getTotalReservedQuantity(sku.id, wh.id, tx)).toBe(40);

      await reservation.releaseReservation(res.id, tx);
      expect(await reservation.getTotalReservedQuantity(sku.id, wh.id, tx)).toBe(0);

      // 예약 레코드 상태 released
      const [row] = await tx
        .select({ status: wmsTables.stockReservations.status })
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.id, res.id));
      expect(row.status).toBe('released');

      // ON_HAND 는 예약/해제와 무관하게 100 유지
      const [ledger] = await tx
        .select({ qty: wmsTables.stockLedgers.qty })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.locationId, loc.id));
      expect(ledger.qty).toBe(100);
    });
  });
});
