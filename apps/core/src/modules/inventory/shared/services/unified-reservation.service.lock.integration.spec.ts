import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { UnifiedReservationService } from './unified-reservation.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService } from '../outbox/outbox.service';

/**
 * reserveStock 의 (sku, warehouse) advisory 락이 TOCTOU 를 직렬화하는지 확인 —
 * 명시적 커밋 필요(락 경합은 동시에 열린 실제 tx 간에만 관찰 가능하므로 rollback-only 패턴 불가).
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev unified-reservation.service.lock.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('UnifiedReservationService reserve lock (DB integration)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(sql, { schema: wmsSchema });
  });
  afterAll(async () => {
    await sql.end();
  });

  function makeService(database: PostgresJsDatabase<typeof wmsSchema>) {
    const run = <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => (tx ? fn(tx) : database.transaction(fn));
    const dbService = { db: database, run } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    return new UnifiedReservationService(dbService, sellable);
  }

  it('available=10 에 동시 10 예약 2건 → 정확히 1건만 성공(락 직렬화)', async () => {
    // fixture: sku·warehouse·location + ON_HAND 10 원장 커밋 (committed 필요 — 동시성 관찰용)
    const wh = (
      await db
        .insert(wmsTables.warehouses)
        .values({ name: `lk-${randomUUID().slice(0, 8)}` })
        .returning()
    )[0];
    const holder = (
      await db
        .insert(wmsTables.holders)
        .values({ name: `lk-${randomUUID().slice(0, 8)}` })
        .returning()
    )[0];
    const sku = (
      await db
        .insert(wmsTables.skus)
        .values({ name: 'lk', code: `LK-${randomUUID()}`, holderId: holder.id })
        .returning()
    )[0];
    const loc = (
      await db
        .insert(wmsTables.locations)
        .values({ warehouseId: wh.id, code: `L-${randomUUID().slice(0, 8)}` })
        .returning()
    )[0];
    await db
      .insert(wmsTables.stockLedgers)
      .values({ skuId: sku.id, warehouseId: wh.id, locationId: loc.id, stockState: 'ON_HAND', qty: 10 });

    const svc = makeService(db);
    const results = await Promise.allSettled([
      svc.reserveStock({
        targetType: 'FULFILLMENT_ORDER',
        targetId: randomUUID(),
        skuId: sku.id,
        warehouseId: wh.id,
        quantity: 10,
      }),
      svc.reserveStock({
        targetType: 'FULFILLMENT_ORDER',
        targetId: randomUUID(),
        skuId: sku.id,
        warehouseId: wh.id,
        quantity: 10,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflict = results.filter((r) => r.status === 'rejected' && r.reason instanceof ConflictException).length;
    expect(ok).toBe(1);
    expect(conflict).toBe(1);

    // cleanup
    await db.delete(wmsTables.stockReservations).where(eqSku(sku.id));
    await db.delete(wmsTables.stockLedgers).where(eqSku(sku.id));
  });
});

function eqSku(skuId: string) {
  return eq(wmsTables.stockReservations.skuId, skuId);
}
