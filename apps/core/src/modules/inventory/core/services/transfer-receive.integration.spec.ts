import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../fulfillment/services/__support__';

/**
 * `transferReceive` 는 ship 과 분리된 트랜잭션에서 불릴 수 있어야 하므로 자체
 * 락·미도착 잔량 검증이 필요하다. 하니스는 Task 2 의
 * `transfer-ship-location.integration.spec.ts` 와 동일한 형태를 쓴다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-receive.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

interface ShippedTransferCtx {
  skuId: string;
  fromWarehouseId: string;
  fromLocationId: string; // 운송중존 ID — 출발 선반이 아니다
  toWarehouseId: string;
  toLocationId: string;
}

describeIfDb('transferReceive 락·잔량 검증·부분 수령 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (trx: DbTx) => Promise<void>): Promise<void> {
    await inRollbackTx(db, fn);
  }

  // 출발/도착 창고, holder/sku, ON_HAND 10 수령, 운송중존 보장, transferShip(opts.qty) 까지
  // 수행한다. fromLocationId 는 transferShip 이 만든 운송중존 ID 다.
  async function seedShippedTransfer(trx: DbTx, opts: { qty: number }): Promise<ShippedTransferCtx> {
    const from = await seedWarehouseWithZone(trx);
    const to = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await receiveStock(w.command, trx, {
      skuId,
      warehouseId: from.warehouseId,
      locationId: from.locationId,
      quantity: 10,
    });

    await w.command.transferShip(
      {
        skuId,
        fromWarehouseId: from.warehouseId,
        fromLocationId: from.locationId,
        quantity: opts.qty,
      },
      trx,
    );

    // transferShip 이 이미 ensureSystemLocations 를 불렀으므로 존은 존재가 보장돼 있다.
    const transitZone = await w.location.getSystemLocationByRole(from.warehouseId, 'transit_out', trx);

    return {
      skuId,
      fromWarehouseId: from.warehouseId,
      fromLocationId: transitZone.id,
      toWarehouseId: to.warehouseId,
      toLocationId: to.locationId,
    };
  }

  async function receiveViaCommandService(
    trx: DbTx,
    input: ShippedTransferCtx & { quantity: number; idempotencyKey?: string },
  ): Promise<{ eventId: string | null }> {
    return w.command.transferReceive(
      {
        skuId: input.skuId,
        fromWarehouseId: input.fromWarehouseId,
        fromLocationId: input.fromLocationId,
        toWarehouseId: input.toWarehouseId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
      },
      trx,
    );
  }

  async function readTransitQty(trx: DbTx, ctx: ShippedTransferCtx): Promise<number> {
    const [row] = await trx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, ctx.skuId),
          eq(wmsTables.stockLedgers.warehouseId, ctx.fromWarehouseId),
          eq(wmsTables.stockLedgers.locationId, ctx.fromLocationId),
          eq(wmsTables.stockLedgers.stockState, 'IN_TRANSFER'),
        ),
      );
    return row?.qty ?? 0;
  }

  async function readDestOnHand(trx: DbTx, ctx: ShippedTransferCtx): Promise<number> {
    const [row] = await trx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, ctx.skuId),
          eq(wmsTables.stockLedgers.warehouseId, ctx.toWarehouseId),
          eq(wmsTables.stockLedgers.locationId, ctx.toLocationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('미도착 잔량을 넘겨 수령하면 409 로 막힌다', async () => {
    await inRollback(async (trx) => {
      const ctx = await seedShippedTransfer(trx, { qty: 5 }); // ON_HAND 10 중 5 를 ship 한 상태
      await expect(receiveViaCommandService(trx, { ...ctx, quantity: 6 })).rejects.toMatchObject({ status: 409 });
    });
  });

  it('부분 수령을 두 번 나눠 받을 수 있고 잔량이 정확히 준다', async () => {
    await inRollback(async (trx) => {
      const ctx = await seedShippedTransfer(trx, { qty: 5 });

      await receiveViaCommandService(trx, { ...ctx, quantity: 3, idempotencyKey: 'r1' });
      expect(await readTransitQty(trx, ctx)).toBe(2);
      expect(await readDestOnHand(trx, ctx)).toBe(3);

      await receiveViaCommandService(trx, { ...ctx, quantity: 2, idempotencyKey: 'r2' });
      expect(await readTransitQty(trx, ctx)).toBe(0);
      expect(await readDestOnHand(trx, ctx)).toBe(5);
    });
  });
});
