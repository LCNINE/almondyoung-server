import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';
import { FulfillmentOrderReservationRetryWorker } from './fulfillment-order-reservation-retry.worker';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';

/**
 * 실제 DB 기반 통합 테스트 — rollback 전용 트랜잭션 (facade 통합 스펙과 동일 패턴).
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev fulfillment-order-reservation-retry.worker.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('FulfillmentOrderReservationRetryWorker (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let worker: FulfillmentOrderReservationRetryWorker;
  let outbox: { enqueue: jest.Mock };

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    const dbService = { db } as unknown as DbService<typeof wmsSchema>;
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    // 실제 예약 경로 전체를 태운다: worker → facade.reserve → unified.reserveStock.
    // FOI variantId가 null이므로 policies는 호출되지 않는다 — 호출되면 실패하도록 미구현 stub.
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const unified = new UnifiedReservationService(dbService, sellable);
    const policies = {} as never;
    const facade = new FulfillmentReservationsFacade(dbService, unified, sellable as never, policies, outbox as never);

    worker = new FulfillmentOrderReservationRetryWorker(dbService, facade);
  });

  beforeEach(() => {
    outbox.enqueue.mockClear();
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

  async function createFixture(
    tx: DbTx,
    options: { foStatus?: 'unfulfillable' | 'created'; fulfillmentMode?: 'drop_ship' | null; onHandQty?: number } = {},
  ) {
    const onHandQty = options.onHandQty ?? 0;

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

    if (onHandQty > 0) {
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `it-loc-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        stockState: 'ON_HAND',
        qty: onHandQty,
      });
    }

    const [fo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        warehouseId: warehouse.id,
        status: options.foStatus ?? 'unfulfillable',
        fulfillmentMode: options.fulfillmentMode ?? null,
        totalItems: 1,
        totalQty: 2,
        totalReservedQty: 0,
        reservationFailureReason: 'RESERVATION_FAILED',
      })
      .returning();
    const [foi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fo.id, skuId: sku.id, qty: 2, reservedQty: 0 })
      .returning();

    return { warehouse, sku, fo, foi };
  }

  it('가용재고가 생긴 unfulfillable FO를 후보로 찾아 예약 → ready 전환 → READY outbox까지 처리한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHandQty: 2 });

      const candidates = await worker.findCandidates(50, tx);
      expect(candidates.map((c) => c.id)).toContain(f.fo.id);

      await worker.retryOne(f.fo.id, tx);

      const [foAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, f.fo.id));
      expect(foAfter).toMatchObject({
        status: 'ready',
        totalReservedQty: 2,
        reservationFailureReason: null,
        reservationFailureDetails: null,
      });

      const [foiAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.foi.id));
      expect(foiAfter.reservedQty).toBe(2);

      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(eq(wmsTables.stockReservations.skuId, f.sku.id), eq(wmsTables.stockReservations.status, 'confirmed')),
        );
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ quantity: 2, fulfillmentOrderItemId: f.foi.id });

      expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ aggregateId: f.fo.id }), tx);
    });
  });

  it('가용재고가 없는 FO는 후보에서 제외된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHandQty: 0 });

      const candidates = await worker.findCandidates(50, tx);
      expect(candidates.map((c) => c.id)).not.toContain(f.fo.id);
    });
  });

  it('재고가 부족분 일부만 있으면(FOI 단위 all-or-nothing) 예약하지 않고 unfulfillable로 유지한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { onHandQty: 1 }); // FOI 부족분은 2

      const candidates = await worker.findCandidates(50, tx);
      expect(candidates.map((c) => c.id)).toContain(f.fo.id);

      await worker.retryOne(f.fo.id, tx);

      const [foAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, f.fo.id));
      expect(foAfter).toMatchObject({ status: 'unfulfillable', totalReservedQty: 0 });
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  it('created 상태(운영자 의도적 해제 포함)와 drop_ship FO는 후보에서 제외된다', async () => {
    await inRollbackTx(async (tx) => {
      const created = await createFixture(tx, { foStatus: 'created', onHandQty: 2 });
      const dropShip = await createFixture(tx, { fulfillmentMode: 'drop_ship', onHandQty: 2 });

      const ids = (await worker.findCandidates(50, tx)).map((c) => c.id);
      expect(ids).not.toContain(created.fo.id);
      expect(ids).not.toContain(dropShip.fo.id);
    });
  });
});
