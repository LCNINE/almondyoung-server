import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { InventoryController } from '../controllers/inventory.controller';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { UnifiedReservationService } from '../../shared/services/unified-reservation.service';
import { StockEventService } from './stock-event.service';
import { SafetyStockService } from './safety-stock.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('adjust idempotency (DB integration, committed rows with unique suffix)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let controller: InventoryController;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
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
    const unifiedReservation = new UnifiedReservationService(dbService, sellable);
    const stockEvent = new StockEventService(dbService, eventStore, command, unifiedReservation);
    const safety = new SafetyStockService(dbService);
    controller = new InventoryController(stockEvent, safety, command);
  });
  afterAll(async () => {
    await sql.end();
  });

  // 멱등성은 커밋된 unique 제약을 통해서만 관측되므로 rollback-only 로는 검증할 수 없다.
  // 고유 접미사 행만 남긴다 (docs/local-dev.md 의 커밋형 스펙과 같은 취급).
  async function seed() {
    const [warehouse] = await db
      .insert(wmsTables.warehouses)
      .values({ name: `it-idem-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await db
      .insert(wmsTables.holders)
      .values({ name: `it-idem-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await db
      .insert(wmsTables.skus)
      .values({ name: 'it-idem-sku', code: `IT-IDEM-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await db
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `IT-IDEM-LOC-${randomUUID().slice(0, 8)}`,
        locationType: 'zone',
      })
      .returning();
    return { warehouse, sku, loc };
  }

  async function onHand(skuId: string, warehouseId: string, locationId: string) {
    const [row] = await db
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }

  it('같은 idempotencyKey 로 두 번 조정해도 원장은 한 번만 움직인다', async () => {
    const { warehouse, sku, loc } = await seed();
    const key = `it-adjust-${randomUUID()}`;
    const body = {
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: 5,
      reason: '발견',
      idempotencyKey: key,
    };

    await controller.adjustStockQuantity(body);
    await controller.adjustStockQuantity(body);

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(5);
  });

  it('키가 다르면 각각 적용된다', async () => {
    const { warehouse, sku, loc } = await seed();
    const base = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: 3, reason: '발견' };

    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjust-${randomUUID()}` });
    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjust-${randomUUID()}` });

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(6);
  });

  it('키가 없으면 매번 적용된다 (기존 호출자 동작 불변)', async () => {
    const { warehouse, sku, loc } = await seed();
    const body = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: 2, reason: '발견' };

    await controller.adjustStockQuantity(body);
    await controller.adjustStockQuantity(body);

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(4);
  });

  // adjustDown 은 재고 부족 검증·위치 선택이 createEvent 의 dedupe 보다 먼저 실행돼,
  // 재시도가 (이미 감소한) ledger 를 다시 읽고 400 을 던지는 문제가 있었다 (리뷰 지적).
  // adjustUp/adjustDown 진입부에 조기 멱등 가드를 추가해 흡수한다.
  it('adjustDown 멱등 재시도 — 완전히 소진해도 두 번째 호출은 에러 없이 흡수된다 (원장 1회만 감소)', async () => {
    const { warehouse, sku, loc } = await seed();
    await controller.adjustStockQuantity({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: 5,
      reason: '입고',
    });
    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(5);

    const key = `it-adjustdown-${randomUUID()}`;
    const body = {
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: -5,
      reason: '파손',
      idempotencyKey: key,
    };

    await controller.adjustStockQuantity(body);
    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(0);

    // 재시도: 첫 호출로 이미 0 까지 소진된 상태에서 같은 키로 다시 -5 를 보내도
    // (수정 전에는 "재고가 부족합니다" 400 이 났다) 에러 없이 흡수돼야 한다.
    await expect(controller.adjustStockQuantity(body)).resolves.toBeDefined();
    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(0);
  });

  it('adjustDown 키가 다르면 각각 적용된다', async () => {
    const { warehouse, sku, loc } = await seed();
    await controller.adjustStockQuantity({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: 10,
      reason: '입고',
    });

    const base = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: -3, reason: '파손' };
    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjustdown-${randomUUID()}` });
    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjustdown-${randomUUID()}` });

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(4); // 10-3-3
  });

  it('adjustDown 키가 없으면 매번 적용된다 (기존 동작 불변)', async () => {
    const { warehouse, sku, loc } = await seed();
    await controller.adjustStockQuantity({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: 10,
      reason: '입고',
    });

    const body = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: -2, reason: '파손' };
    await controller.adjustStockQuantity(body);
    await controller.adjustStockQuantity(body);

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(6); // 10-2-2
  });
});
