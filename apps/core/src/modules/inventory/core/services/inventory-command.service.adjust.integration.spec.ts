import { BadRequestException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

/**
 * adjustUp/adjustDown 위치 미지정(관리자 재고 조정 다이얼로그) 경로 통합 테스트 —
 * rollback 전용 트랜잭션 (facade 통합 스펙과 동일 패턴).
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev inventory-command.service.adjust.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('InventoryCommandService adjust (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
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

  async function onHandTotal(tx: DbTx, skuId: string, warehouseId: string) {
    const rows = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return rows.reduce((sum, r) => sum + r.qty, 0);
  }

  it('위치 미지정 adjustUp: 시스템 입고기본존으로 ledger가 증가하고 ADJUST_UP 이벤트가 남는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx);

      const result = await command.adjustUp(
        { skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 5, reason: 'STOCKTAKING' },
        tx,
      );
      expect(result.eventId).toBeTruthy();

      expect(await onHandTotal(tx, f.sku.id, f.warehouse.id)).toBe(5);

      const [event] = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.id, result.eventId));
      expect(event).toMatchObject({ transitionType: 'ADJUST_UP', quantity: 5, eventStatus: 'POSTED' });
      expect(event.toLocationId).toBeTruthy();
    });
  });

  it('위치 미지정 adjustDown: ON_HAND가 있는 위치에서 차감된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx);
      await command.adjustUp({ skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 3, reason: 'SEED' }, tx);

      await command.adjustDown({ skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 2, reason: 'DAMAGED' }, tx);

      expect(await onHandTotal(tx, f.sku.id, f.warehouse.id)).toBe(1);
    });
  });

  it('위치 미지정 adjustDown: 재고 부족이면 400으로 거부되고 ledger가 변하지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx);
      await command.adjustUp({ skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 1, reason: 'SEED' }, tx);

      await expect(
        command.adjustDown({ skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 2, reason: 'LOST' }, tx),
      ).rejects.toThrow(BadRequestException);

      expect(await onHandTotal(tx, f.sku.id, f.warehouse.id)).toBe(1);
    });
  });

  it('위치 미지정 adjustDown: ON_HAND가 전혀 없으면 400으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx);

      await expect(
        command.adjustDown({ skuId: f.sku.id, warehouseId: f.warehouse.id, quantity: 1, reason: 'LOST' }, tx),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
