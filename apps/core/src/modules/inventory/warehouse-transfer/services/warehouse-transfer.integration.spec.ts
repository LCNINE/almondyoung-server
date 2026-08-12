import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
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
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from './warehouse-transfer.manager';
import { WarehouseTransferService } from './warehouse-transfer.service';
import { WarehouseTransferReader } from './warehouse-transfer.reader';

/**
 * 이동 지시서 도메인 — 생성 → 선적 → 부분 도착 → 마감이 문서 수량과 원장을 함께
 * 움직이는지 본다. 하니스는 Task 4 의 `transfer-receive.integration.spec.ts` 와
 * 동일한 형태를 쓴다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('이동 지시서 도메인 (DB integration)', () => {
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

  /**
   * 롤백 트랜잭션에 묶인 DbService 대역. `run` 이 반드시 있어야 한다 — 없으면
   * Manager 가 트랜잭션을 열지 못한다. tx 미지정 호출도 trx 로 흡수해 스펙 밖으로
   * 새는 커밋을 막는다.
   */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildManager(trx: DbTx): WarehouseTransferManager {
    const dbService = boundDbService(trx);
    return new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
  }

  function buildService(trx: DbTx): WarehouseTransferService {
    return new WarehouseTransferService(buildManager(trx));
  }

  function buildReader(trx: DbTx): WarehouseTransferReader {
    return new WarehouseTransferReader(boundDbService(trx));
  }

  async function seedTwoWarehousesWithStock(
    trx: DbTx,
    qty: number,
  ): Promise<{
    from: { warehouseId: string; locationId: string };
    to: { warehouseId: string; locationId: string };
    skuId: string;
  }> {
    const from = await seedWarehouseWithZone(trx);
    const to = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await receiveStock(w.command, trx, {
      skuId,
      warehouseId: from.warehouseId,
      locationId: from.locationId,
      quantity: qty,
    });
    return { from, to, skuId };
  }

  async function readOrderStatus(trx: DbTx, transferOrderId: string): Promise<string> {
    const [row] = await trx
      .select({ status: wmsTables.transferOrders.status })
      .from(wmsTables.transferOrders)
      .where(eq(wmsTables.transferOrders.id, transferOrderId))
      .limit(1);
    return row?.status ?? '';
  }

  async function readFirstLineId(trx: DbTx, transferOrderId: string): Promise<string> {
    const [row] = await trx
      .select({ id: wmsTables.transferOrderLines.id })
      .from(wmsTables.transferOrderLines)
      .where(eq(wmsTables.transferOrderLines.transferOrderId, transferOrderId))
      .orderBy(wmsTables.transferOrderLines.createdAt)
      .limit(1);
    return row?.id ?? '';
  }

  // 창고 grain 합계 — 로케이션이 여럿이어도 창고 단위로 본다.
  async function readLedgerSum(
    trx: DbTx,
    skuId: string,
    warehouseId: string,
    state: 'ON_HAND' | 'IN_TRANSFER',
  ): Promise<number> {
    const rows = await trx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, state),
        ),
      );
    return rows.reduce((sum, row) => sum + row.qty, 0);
  }

  const readOnHand = (trx: DbTx, skuId: string, warehouseId: string) =>
    readLedgerSum(trx, skuId, warehouseId, 'ON_HAND');
  const readInTransit = (trx: DbTx, skuId: string, warehouseId: string) =>
    readLedgerSum(trx, skuId, warehouseId, 'IN_TRANSFER');

  it('생성 → 선적 → 부분 도착 → 전량 도착으로 상태와 원장이 함께 움직인다', async () => {
    await inRollback(async (trx) => {
      const { from, to, skuId } = await seedTwoWarehousesWithStock(trx, 10);
      const svc = buildService(trx);

      const { transferOrderId } = await svc.createOrder(
        {
          fromWarehouseId: from.warehouseId,
          toWarehouseId: to.warehouseId,
          eta: new Date('2026-09-01'),
          lines: [{ skuId, fromLocationId: from.locationId, quantity: 6 }],
        },
        trx,
      );
      expect(await readOrderStatus(trx, transferOrderId)).toBe('draft');

      await svc.ship({ transferOrderId, idempotencyKey: 'ship-1' }, trx);
      expect(await readOrderStatus(trx, transferOrderId)).toBe('shipped');
      expect(await readOnHand(trx, skuId, from.warehouseId)).toBe(4);
      expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(6);

      const lineId = await readFirstLineId(trx, transferOrderId);
      await svc.receive(
        {
          transferOrderId,
          idempotencyKey: 'rcv-1',
          toLocationId: to.locationId,
          lines: [{ transferOrderLineId: lineId, receivedQty: 4, lostQty: 0 }],
        },
        trx,
      );
      expect(await readOrderStatus(trx, transferOrderId)).toBe('partially_received');
      expect(await readOnHand(trx, skuId, to.warehouseId)).toBe(4);
      expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(2);

      await svc.receive(
        {
          transferOrderId,
          idempotencyKey: 'rcv-2',
          toLocationId: to.locationId,
          lines: [{ transferOrderLineId: lineId, receivedQty: 1, lostQty: 1 }],
        },
        trx,
      );
      expect(await readOrderStatus(trx, transferOrderId)).toBe('closed');
      expect(await readOnHand(trx, skuId, to.warehouseId)).toBe(5);
      // 분실 1 은 어느 창고에도 더해지지 않고 IN_TRANSFER 에서만 사라진다.
      expect(await readInTransit(trx, skuId, from.warehouseId)).toBe(0);
      expect(await readOnHand(trx, skuId, from.warehouseId)).toBe(4);
    });
  });

  it('미완결 조회가 선적 후 남은 잔량을 정확히 낸다', async () => {
    await inRollback(async (trx) => {
      const { from, to, skuId } = await seedTwoWarehousesWithStock(trx, 10);
      const svc = buildService(trx);
      const { transferOrderId } = await svc.createOrder(
        {
          fromWarehouseId: from.warehouseId,
          toWarehouseId: to.warehouseId,
          lines: [{ skuId, fromLocationId: from.locationId, quantity: 6 }],
        },
        trx,
      );
      await svc.ship({ transferOrderId, idempotencyKey: 'ship-1' }, trx);

      const outstanding = await buildReader(trx).findOutstanding(trx);
      const mine = outstanding.filter((o) => o.transferOrderId === transferOrderId);
      expect(mine).toHaveLength(1);
      expect(mine[0].outstandingQty).toBe(6);
      expect(mine[0].skuId).toBe(skuId);
      expect(mine[0].toWarehouseId).toBe(to.warehouseId);
    });
  });
});
