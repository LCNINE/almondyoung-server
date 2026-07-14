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
import { StockEventService } from './stock-event.service';
import { TransferService } from './transfer.service';

/**
 * Path B(inventory/transfers) 창고간 이동 무손실 통합 검증. rollback 전용 트랜잭션.
 * 성공 기준: create+execute 후 origin ON_HAND −N, dest ON_HAND +N, IN_TRANSFER 잔량 0.
 *           재-execute 는 이중출고 없이 원장 불변(eventId skip 가드).
 *
 * 실행 (throwaway 로컬 Postgres):
 *   1) docker run -d --name almond-it-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=core_it \
 *        -p 54329:5432 postgres:16-alpine
 *   2) DATABASE_URL=postgresql://postgres:postgres@localhost:54329/core_it \
 *        npx drizzle-kit migrate --config apps/core/drizzle.config.ts
 *   3) DATABASE_URL=…54329/core_it npx jest --testPathPattern="transfer\.service\.integration" --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('TransferService inter-warehouse 무손실 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let transfer: TransferService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    // DbService 최소 대역 (ADR-0025 단일 러너): tx 전파만 사용(spec 은 항상 rollback tx 전파).
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
    // transferBetweenWarehouses 는 command.transferShip/Receive 만 사용 —
    // unifiedReservation·allocationStrategy 미사용이라 대역 불요(undefined 밴드).
    const stockEventService = new StockEventService(
      dbService,
      eventStore,
      command,
      undefined as never,
      undefined as never,
    );
    transfer = new TransferService(dbService, stockEventService, command);
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

  async function seed(tx: DbTx, onHand: number) {
    const [wa] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wa-${randomUUID().slice(0, 8)}` })
      .returning();
    const [wb] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wb-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    // 유효한 최소 로케이션: zone (ck_locations_type — zone 은 rack/bin NULL 허용)
    const [locA] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wa.id, code: `IT-A-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    const [locB] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: wb.id, code: `IT-B-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
      .returning();
    // origin ON_HAND 시드 (원장 경유)
    await command.receive({ skuId: sku.id, toWarehouseId: wa.id, toLocationId: locA.id, quantity: onHand }, tx);
    return { wa, wb, sku, locA, locB };
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

  async function inTransferTotal(tx: DbTx, skuId: string): Promise<number> {
    const rows = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.stockState, 'IN_TRANSFER')));
    return rows.reduce((s, r) => s + (r.qty ?? 0), 0);
  }

  it('create+execute 는 재고를 보존한다 (origin −N, dest +N, IN_TRANSFER 0)', async () => {
    await inRollbackTx(async (tx) => {
      const { wa, wb, sku, locA, locB } = await seed(tx, 100);

      const { jobId } = await transfer.createTransferJob(
        {
          fromWarehouseId: wa.id,
          toWarehouseId: wb.id,
          items: [{ skuId: sku.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 }],
        },
        tx,
      );
      await transfer.executeTransferJob({ jobId }, tx);

      expect(await onHandQty(tx, sku.id, wa.id, locA.id)).toBe(60);
      expect(await onHandQty(tx, sku.id, wb.id, locB.id)).toBe(40);
      expect(await inTransferTotal(tx, sku.id)).toBe(0);
    });
  });

  it('재-execute 는 이중출고 없이 원장을 유지한다 (eventId skip)', async () => {
    await inRollbackTx(async (tx) => {
      const { wa, wb, sku, locA, locB } = await seed(tx, 100);

      const { jobId } = await transfer.createTransferJob(
        {
          fromWarehouseId: wa.id,
          toWarehouseId: wb.id,
          items: [{ skuId: sku.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 }],
        },
        tx,
      );
      await transfer.executeTransferJob({ jobId }, tx);
      const second = await transfer.executeTransferJob({ jobId }, tx);

      expect(second.linesExecuted).toBe(0);
      expect(await onHandQty(tx, sku.id, wa.id, locA.id)).toBe(60);
      expect(await onHandQty(tx, sku.id, wb.id, locB.id)).toBe(40);
      expect(await inTransferTotal(tx, sku.id)).toBe(0);
    });
  });
});
