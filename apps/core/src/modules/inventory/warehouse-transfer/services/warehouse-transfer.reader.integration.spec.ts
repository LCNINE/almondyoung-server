import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
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
import { WarehouseTransferReader } from './warehouse-transfer.reader';

/**
 * draft 지시서에 실린 planned 합. 보충 제안(#743)이 "어제 제안으로 이미 초안을 만든 수량"을
 * 이동가능에서 빼기 위해 쓴다. 선적된 지시서는 세지 않는다 — 그 물량은 이미 IN_TRANSFER 라
 * 원장에서 빠져 있고, 여기서도 세면 이중 차감이다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WarehouseTransferReader.findDraftPlannedBySku (DB integration)', () => {
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

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  it('draft 지시서의 planned 만 SKU 별로 합한다 — 선적된 것은 제외', async () => {
    await inRollbackTx(db, async (trx) => {
      const source = await seedWarehouseWithZone(trx);
      await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, source.warehouseId));
      const dest = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const { skuId: otherSkuId } = await seedSku(trx, holderId);
      await receiveStock(w.command, trx, { skuId, warehouseId: source.warehouseId, locationId: source.locationId, quantity: 500 });

      const dbService = boundDbService(trx);
      const manager = new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
      const reader = new WarehouseTransferReader(dbService);

      // draft 두 건 (30 + 20)
      await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 30 }] },
        trx,
      );
      await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 20 }] },
        trx,
      );
      // 선적된 한 건 (40) — 세면 안 된다
      const shipped = await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 40 }] },
        trx,
      );
      await manager.ship({ transferOrderId: shipped.transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);

      const result = await reader.findDraftPlannedBySku(trx, [skuId, otherSkuId]);
      expect(result.get(skuId)).toBe(50);
      expect(result.has(otherSkuId)).toBe(false);
    });
  });

  it('빈 입력은 빈 Map', async () => {
    await inRollbackTx(db, async (trx) => {
      const reader = new WarehouseTransferReader(boundDbService(trx));
      expect((await reader.findDraftPlannedBySku(trx, [])).size).toBe(0);
    });
  });
});
