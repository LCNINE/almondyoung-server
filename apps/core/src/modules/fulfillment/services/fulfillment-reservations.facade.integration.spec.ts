import { ConflictException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';

/**
 * 실제 DB 기반 통합 테스트 — rollback 전용 트랜잭션.
 *
 * 모든 fixture 생성/검증/facade 호출을 하나의 트랜잭션 안에서 수행하고
 * 마지막에 강제 rollback 하므로 dev DB에 데이터를 남기지 않는다.
 * DATABASE_URL이 없으면 전체 skip (일반 `npm run test`에서는 실행되지 않음).
 *
 * 실행 (core dev DB는 VPC 내부 — 터널 + sst shell 필요):
 *   1) 별도 터미널: ./scripts/sst-tunnel.sh deployments/lcnine/services dev
 *   2) ./scripts/test-core-integration.sh dev fulfillment-reservations.facade.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('FulfillmentReservationsFacade (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let facade: FulfillmentReservationsFacade;
  let outbox: { enqueue: jest.Mock };

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    // transfer/candidates 경로는 unified/productSellableQuantity를 호출하지 않고,
    // FOI variantId가 null이면 policies도 호출하지 않는다 — 호출되면 테스트가 실패하도록 미구현 stub
    const unified = {} as never;
    const productSellableQuantity = {} as never;
    const policies = {} as never;

    facade = new FulfillmentReservationsFacade(
      { db } as unknown as DbService<typeof wmsSchema>,
      unified,
      productSellableQuantity,
      policies,
      outbox as never,
    );

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

  interface Fixture {
    warehouseId: string;
    skuId: string;
    fromFo: { id: string };
    toFo: { id: string };
    fromFoi: { id: string };
    toFoi: { id: string };
  }

  async function createFixture(
    tx: DbTx,
    options: { fromFoStatus?: 'ready' | 'picking'; reservedQty?: number; fromQty?: number; toQty?: number } = {},
  ): Promise<Fixture> {
    const reservedQty = options.reservedQty ?? 2;
    const fromQty = options.fromQty ?? 2;
    const toQty = options.toQty ?? 2;

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

    const [fromFo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        warehouseId: warehouse.id,
        status: options.fromFoStatus ?? 'ready',
        totalReservedQty: reservedQty,
        totalItems: 1,
        totalQty: 2,
      })
      .returning();
    const [toFo] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ warehouseId: warehouse.id, status: 'created', totalItems: 1, totalQty: 2 })
      .returning();

    const [fromFoi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fromFo.id, skuId: sku.id, qty: fromQty, reservedQty })
      .returning();
    const [toFoi] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: toFo.id, skuId: sku.id, qty: toQty, reservedQty: 0 })
      .returning();

    if (reservedQty > 0) {
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'FULFILLMENT_ORDER',
        targetId: fromFo.id,
        fulfillmentOrderItemId: fromFoi.id,
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: reservedQty,
        status: 'confirmed',
      });
    }

    return { warehouseId: warehouse.id, skuId: sku.id, fromFo, toFo, fromFoi, toFoi };
  }

  async function confirmedReservations(tx: DbTx, skuId: string) {
    return tx
      .select()
      .from(wmsTables.stockReservations)
      .where(and(eq(wmsTables.stockReservations.skuId, skuId), eq(wmsTables.stockReservations.status, 'confirmed')));
  }

  it('cross-FO 전체 이전: row 이동, 수량 정합, FO 상태 전환, 후보 조회까지 실제 DB에서 검증한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx);

      // 이전 전 후보 조회: toFoi가 cross-FO 후보로 보여야 한다 (column-to-column gt 포함 실제 SQL)
      const before = await facade.getTransferCandidates(f.fromFo.id, f.fromFoi.id, tx);
      expect(before.map((c) => c.id)).toContain(f.toFoi.id);
      const candidate = before.find((c) => c.id === f.toFoi.id);
      expect(candidate).toMatchObject({ shortage: 2, sameFulfillmentOrder: false });

      await facade.transferReservation(
        f.fromFo.id,
        {
          fromFulfillmentOrderItemId: f.fromFoi.id,
          toFulfillmentOrderItemId: f.toFoi.id,
          quantity: 2,
          performedBy: 'it-tester',
        },
        tx,
      );

      // confirmed 합계 보존 + 소유 FOI 이동
      const rows = await confirmedReservations(tx, f.skuId);
      expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(2);
      expect(rows).toHaveLength(1);
      expect(rows[0].fulfillmentOrderItemId).toBe(f.toFoi.id);
      expect(rows[0].targetId).toBe(f.toFo.id);
      expect(rows[0].reason).toContain('it-tester');

      // FOI reservedQty 정합
      const [fromFoiAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.fromFoi.id));
      const [toFoiAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, f.toFoi.id));
      expect(fromFoiAfter.reservedQty).toBe(0);
      expect(toFoiAfter.reservedQty).toBe(2);

      // FO 상태/totalReservedQty: from은 예약을 잃어 created로, to는 완전 예약되어 ready로
      const [fromFoAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, f.fromFo.id));
      const [toFoAfter] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, f.toFo.id));
      expect(fromFoAfter).toMatchObject({ status: 'created', totalReservedQty: 0 });
      expect(toFoAfter).toMatchObject({ status: 'ready', totalReservedQty: 2 });
      expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ aggregateId: f.toFo.id }), tx);

      // 이전 후 후보 재조회: from reservedQty=0 → source-side 정책으로 빈 배열
      const after = await facade.getTransferCandidates(f.fromFo.id, f.fromFoi.id, tx);
      expect(after).toEqual([]);
    });
  });

  it('작업중(picking) FO에서는 실제 DB에서도 이전이 409로 차단되고 아무 row도 변하지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await createFixture(tx, { fromFoStatus: 'picking' });

      await expect(
        facade.transferReservation(
          f.fromFo.id,
          { fromFulfillmentOrderItemId: f.fromFoi.id, toFulfillmentOrderItemId: f.toFoi.id, quantity: 1 },
          tx,
        ),
      ).rejects.toThrow(ConflictException);

      const rows = await confirmedReservations(tx, f.skuId);
      expect(rows).toHaveLength(1);
      expect(rows[0].fulfillmentOrderItemId).toBe(f.fromFoi.id);

      // source-side 정책: picking 상태 FO의 후보 조회도 빈 배열
      const candidates = await facade.getTransferCandidates(f.fromFo.id, f.fromFoi.id, tx);
      expect(candidates).toEqual([]);
    });
  });
});
