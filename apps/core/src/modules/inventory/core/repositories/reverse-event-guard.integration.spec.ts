import { ConflictException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from './stock-event.store';
import { InventoryCommandService } from '../services/inventory-command.service';
import { LocationService } from '../services/location.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

/**
 * reverseEvent 락·가드(작업 10b) 통합 테스트 — rollback 전용 (adjust 통합 스펙과 동일 패턴).
 *
 * 실행 (core dev DB 는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev reverse-event-guard.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('StockEventStore.reverseEvent lock+guard (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let eventStore: StockEventStore;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function createFixture(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    return { warehouse, sku };
  }

  async function reserve(tx: DbTx, skuId: string, warehouseId: string, quantity: number) {
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'FULFILLMENT_ORDER',
      targetId: randomUUID(),
      skuId,
      warehouseId,
      quantity,
      status: 'confirmed',
    });
  }

  it('ON_HAND 증가 이벤트(ADJUST_UP) 역분개는 예약이 있으면 409 로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const up = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await reserve(tx, sku.id, warehouse.id, 10);
      // +10 역분개 → ON_HAND 0 < 예약 10
      await expect(eventStore.reverseEvent(up.eventId, 'TEST', tx)).rejects.toThrow(ConflictException);
    });
  });

  it('예약이 없으면 증가 이벤트 역분개가 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      const up = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      await expect(eventStore.reverseEvent(up.eventId, 'TEST', tx)).resolves.toBeDefined();
    });
  });

  it('여유가 있으면(차감 후 ON_HAND ≥ 예약) 증가 이벤트 역분개가 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      const up2 = await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5 }, tx);
      await reserve(tx, sku.id, warehouse.id, 6);
      // +5 역분개 → ON_HAND 15-5=10 ≥ 예약 6
      await expect(eventStore.reverseEvent(up2.eventId, 'TEST', tx)).resolves.toBeDefined();
    });
  });

  it('ON_HAND 감소 이벤트(ADJUST_DOWN) 역분개는 증가 방향이라 예약이 꽉 차도 가드 없이 성공한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await createFixture(tx);
      await command.adjustUp({ skuId: sku.id, warehouseId: warehouse.id, quantity: 10 }, tx);
      const down = await command.adjustDown({ skuId: sku.id, warehouseId: warehouse.id, quantity: 5 }, tx);
      await reserve(tx, sku.id, warehouse.id, 5); // 예약 5 == 현재 ON_HAND 5
      // ADJUST_DOWN 역분개 = +5 (증가) → 가드 미적용, 성공
      await expect(eventStore.reverseEvent(down.eventId, 'TEST', tx)).resolves.toBeDefined();
    });
  });
});
