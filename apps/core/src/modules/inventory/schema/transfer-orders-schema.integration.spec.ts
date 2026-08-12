import { sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from './inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone, seedHolder, seedSku } from '../../fulfillment/services/__support__';

/**
 * transfer_orders 문서가 소유하는 제약(정산 부등식·창고 교차)이 실제로 DB 에서 막는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-orders-schema.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// drizzle-orm 은 postgres.js 에러를 DrizzleQueryError 로 감싸고, 실제 postgres 메시지(제약 이름 포함)는
// `.message` 가 아니라 `.cause.message` 에 있다 — jest 의 `rejects.toThrow(regex)` 는 `.cause` 를 보지 않으므로
// 직접 풀어서 매칭한다.
async function expectConstraintViolation(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const err = caught as Error & { cause?: { message?: string } };
  const detail = err.cause?.message ?? err.message;
  expect(detail).toMatch(pattern);
}

describeIfDb('transfer_orders 스키마 (PostgreSQL constraints, rollback-only)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedTransferOrderLine(
    tx: DbTx,
    args: { plannedQty: number; shippedQty: number },
  ): Promise<{ orderId: string; lineId: string }> {
    const from = await seedWarehouseWithZone(tx);
    const to = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);

    const [order] = await tx
      .insert(wmsTables.transferOrders)
      .values({ fromWarehouseId: from.warehouseId, toWarehouseId: to.warehouseId })
      .returning();

    const [line] = await tx
      .insert(wmsTables.transferOrderLines)
      .values({
        transferOrderId: order.id,
        skuId,
        fromLocationId: from.locationId,
        plannedQty: args.plannedQty,
        shippedQty: args.shippedQty,
      })
      .returning();

    return { orderId: order.id, lineId: line.id };
  }

  it('선적량을 넘겨 수령할 수 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { lineId } = await seedTransferOrderLine(trx, { plannedQty: 10, shippedQty: 10 });
      await expectConstraintViolation(
        trx.execute(sql`UPDATE transfer_order_lines SET received_qty = 11 WHERE id = ${lineId}`),
        /ck_transfer_order_lines_settlement/,
      );
    });
  });

  it('수령 + 분실이 선적량을 넘을 수 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { lineId } = await seedTransferOrderLine(trx, { plannedQty: 10, shippedQty: 10 });
      await trx.execute(sql`UPDATE transfer_order_lines SET received_qty = 8 WHERE id = ${lineId}`);
      await expectConstraintViolation(
        trx.execute(sql`UPDATE transfer_order_lines SET lost_qty = 3 WHERE id = ${lineId}`),
        /ck_transfer_order_lines_settlement/,
      );
    });
  });

  it('같은 창고끼리는 이동 지시서를 만들 수 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const wh = await seedWarehouseWithZone(trx);
      await expectConstraintViolation(
        trx.insert(wmsTables.transferOrders).values({
          fromWarehouseId: wh.warehouseId,
          toWarehouseId: wh.warehouseId,
        }),
        /ck_transfer_orders_cross_warehouse/,
      );
    });
  });
});
