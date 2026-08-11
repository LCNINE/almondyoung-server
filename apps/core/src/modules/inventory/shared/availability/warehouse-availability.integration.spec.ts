import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { seedPickableShipment } from '../../../fulfillment/services/__support__/logistics-fixtures';
import { readWarehouseAvailability } from './warehouse-availability';

/**
 * 가용재고 정본 판독의 실 DB 검증. rollback 전용 트랜잭션.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-availability.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('readWarehouseAvailability (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  /**
   * ON_HAND 원장 + confirmed 예약을 심고 grain 을 돌려준다.
   *
   * 예약을 손으로 INSERT 하지 않는 이유: `stock_reservations.shipment_line_id` 가
   * NOT NULL + FK → `shipment_lines` 라(Task 25 계약) 유효한 예약 하나에
   * fulfillment_orders → items → shipments → shipment_lines 4단 체인이 필요하다.
   * `seedPickableShipment` 이 그 체인 + ON_HAND 원장 + confirmed 예약을 한 번에 만든다.
   */
  const seed = async (
    trx: DbTx,
    opts: { onHand: number; reserved: number },
  ): Promise<{ skuId: string; warehouseId: string; locationId: string }> => {
    const fx = await seedPickableShipment(trx, opts.onHand);
    // 픽스처는 예약 = ON_HAND 로 심는다. 원하는 예약 수량으로 낮추거나(0 이면 삭제) 맞춘다.
    if (opts.reserved === 0) {
      await trx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));
    } else if (opts.reserved !== opts.onHand) {
      await trx
        .update(wmsTables.stockReservations)
        .set({ quantity: opts.reserved })
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));
    }
    return { skuId: fx.skuId, warehouseId: fx.warehouseId, locationId: fx.locationId };
  };

  it('ON_HAND 합 − confirmed 예약 합을 반환한다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId } = await seed(trx, { onHand: 10, reserved: 4 });
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result).toEqual({ onHand: 10, reserved: 4, available: 6 });
    });
  });

  it('원장도 예약도 없으면 0 을 반환한다 (null 이 아니라)', async () => {
    await inRollback(async (trx) => {
      const result = await readWarehouseAvailability(trx, randomUUID(), randomUUID());
      expect(result).toEqual({ onHand: 0, reserved: 0, available: 0 });
    });
  });

  it('released 예약은 차감하지 않는다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId } = await seed(trx, { onHand: 10, reserved: 4 });
      await trx
        .update(wmsTables.stockReservations)
        .set({ status: 'released' })
        .where(eq(wmsTables.stockReservations.skuId, skuId));
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result.available).toBe(10);
    });
  });

  it('ON_HAND 가 아닌 원장 상태는 합산하지 않는다', async () => {
    await inRollback(async (trx) => {
      const { skuId, warehouseId, locationId } = await seed(trx, { onHand: 10, reserved: 0 });
      await trx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'DEFECTIVE',
        qty: 99,
      });
      const result = await readWarehouseAvailability(trx, skuId, warehouseId);
      expect(result.onHand).toBe(10);
    });
  });
});
