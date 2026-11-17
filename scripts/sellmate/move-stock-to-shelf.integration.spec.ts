import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConflictException } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  onHandAt,
  receiveStock,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
} from '../../apps/core/src/modules/fulfillment/services/__support__';
import {
  buildWiring,
  Database,
  makeInboundService,
  makeMovementService,
} from '../../apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness';
import {
  seedBox,
  seedFo,
  seedOrder,
  seedWorkItem,
} from '../../apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures';
import { lockSkuCapacities } from '../../apps/core/src/modules/fulfillment/picking/allocation/allocation.locks';
import { MovementService } from '../../apps/core/src/modules/inventory/movement/services/movement.service';
import { runShelfMove, ShelfMoveOptions } from './move-stock-to-shelf';

/**
 * 컷오버 재고 이동(#1236). 롤백 트랜잭션 안에서만 돈다 — MovementService 에 바깥 트랜잭션을 DB 로 넘기면
 * 그 안의 트랜잭션은 savepoint 가 된다(inbound-origin-protection.integration.spec.ts 와 같은 방식).
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'move-stock-to-shelf\.integration\.spec\.ts$'
 * (로컬 core DB 의 마이그가 깨져 있으면 새 DB 를 만들어 마이그한 뒤 DATABASE_URL=… npx jest --runTestsByPath <이 파일> --runInBand)
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const SINCE = new Date('2026-11-20T09:00:00Z');
const FRESH = new Date('2026-11-20T10:00:00Z');
const opts = (over: Partial<ShelfMoveOptions> = {}): ShelfMoveOptions => ({
  apply: true,
  positionsSince: SINCE,
  includeRules: new Set(),
  ...over,
});

async function world(tx: DbTx) {
  const asDb = tx as unknown as Database;
  const wiring = buildWiring(asDb);
  const { warehouseId } = await seedWarehouseWithZone(tx);
  await wiring.location.ensureSystemLocations(warehouseId, tx);
  const inbound = await wiring.location.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
  if (!inbound) throw new Error('입고기본존이 없다');
  const { holderId } = await seedHolder(tx);
  const [column] = await tx.insert(wmsTables.locationColumns).values({ warehouseId, columnName: 'A' }).returning();
  const [rack] = await tx.insert(wmsTables.locationRacks).values({ columnId: column.id, rackNumber: 1 }).returning();

  const shelf = async (bin: string, isActive = true) => {
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId,
        code: `A-01-${bin}`,
        locationType: 'standard',
        rackId: rack.id,
        binIdentifier: bin,
        isActive,
      })
      .returning();
    return loc.id;
  };
  const sku = async (positionCode: string | null, updatedAt = FRESH) => {
    const s = await seedSku(tx, holderId);
    if (positionCode !== null) {
      await tx.insert(wmsTables.skuShelfPositions).values({ skuId: s.skuId, positionCode, updatedAt });
    }
    return s;
  };
  const receive = (skuId: string, quantity: number, locationId = inbound.id) =>
    receiveStock(wiring.command, tx, { skuId, warehouseId, locationId, quantity });
  const run = (o: ShelfMoveOptions, movement: MovementService = makeMovementService(asDb)) =>
    runShelfMove(tx as unknown as PostgresJsDatabase<typeof wmsSchema>, { movement, guard: wiring.guard }, o).then(
      (rows) => rows.filter((r) => r.warehouseId === warehouseId),
    );
  const moveEvents = async (skuId: string) =>
    tx
      .select()
      .from(wmsTables.stockEvents)
      .where(and(eq(wmsTables.stockEvents.skuId, skuId), eq(wmsTables.stockEvents.transitionType, 'MOVE')));
  return { asDb, wiring, warehouseId, holderId, inboundId: inbound.id, shelf, sku, receive, run, moveEvents };
}

describeIfDb('runShelfMove (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('위치가 하나인 SKU 의 입고기본존 재고를 그 선반으로 MOVE 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const shelfId = await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ skuCode: s.skuCode, outcome: 'moved', movedQty: 10, toCode: 'A-01-01' });
      expect(await onHandAt(tx, s.skuId, w.inboundId)).toBe(0);
      expect(await onHandAt(tx, s.skuId, shelfId)).toBe(10);
      expect(await w.moveEvents(s.skuId)).toHaveLength(1);
    });
  });

  it('dry-run 은 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);

      const [row] = await w.run(opts({ apply: false }));

      expect(row).toMatchObject({ outcome: 'would-move', movedQty: 10 });
      expect(await onHandAt(tx, s.skuId, w.inboundId)).toBe(10);
      expect(await w.moveEvents(s.skuId)).toHaveLength(0);
    });
  });

  it('다시 돌려도 두 번 옮기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);

      await w.run(opts());
      const again = await w.run(opts());

      expect(again.filter((r) => r.skuId === s.skuId && r.outcome === 'moved')).toEqual([]);
      expect(await w.moveEvents(s.skuId)).toHaveLength(1);
    });
  });

  it('ON_HAND 가 아닌 원장 행은 대상이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const s = await w.sku('A-01-01');
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: s.skuId,
        warehouseId: w.warehouseId,
        locationId: w.inboundId,
        stockState: 'RETURNED',
        qty: 5,
      });

      const rows = await w.run(opts());

      expect(rows.filter((r) => r.skuId === s.skuId)).toEqual([]);
    });
  });

  it('적치 대기 입고분은 남기고 나머지만 옮긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const shelfId = await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 7);
      await makeInboundService(w.asDb).simpleInbound(
        { warehouseId: w.warehouseId, items: [{ skuId: s.skuId, quantity: 3 }], idempotencyKey: randomUUID() },
        tx,
      );

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ outcome: 'moved', qty: 10, movedQty: 7 });
      expect(await onHandAt(tx, s.skuId, shelfId)).toBe(7);
      expect(await onHandAt(tx, s.skuId, w.inboundId)).toBe(3);
    });
  });

  it('피킹 배정이 걸린 SKU 는 옮기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);
      const ow = { warehouseId: w.warehouseId, skuId: s.skuId, holderId: w.holderId };
      const order = await seedOrder(tx);
      const fo = await seedFo(tx, ow, order);
      const box = await seedBox(tx, ow, [fo.foItemId], { status: 'planned' });
      await seedWorkItem(tx, ow, box.shipmentId, { status: 'picking' });
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, box.shipmentId));
      await tx.insert(wmsTables.pickingSourceAllocations).values({
        workItemId: item.id,
        shipmentLineId: box.lineIds[0],
        sourceLocationId: w.inboundId,
        qty: 1,
        sourceStockVersion: 1,
      });

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ outcome: 'keep:allocated', movedQty: 0 });
      expect(await onHandAt(tx, s.skuId, w.inboundId)).toBe(10);
    });
  });

  it('다른 선반에 이미 재고가 있는 SKU 는 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const other = await w.shelf('02');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);
      await w.receive(s.skuId, 2, other);

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ outcome: 'keep:elsewhere' });
    });
  });

  it('T 당일 적재가 다시 쓰지 않은 위치 행은 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const s = await w.sku('A-01-01', new Date('2026-11-19T00:00:00Z'));
      await w.receive(s.skuId, 10);

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ outcome: 'keep:stale' });
    });
  });

  it('원장과 입고 대기가 어긋난 SKU 는 남기고 실행을 계속한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const broken = await w.sku('A-01-01');
      await makeInboundService(w.asDb).simpleInbound(
        { warehouseId: w.warehouseId, items: [{ skuId: broken.skuId, quantity: 10 }], idempotencyKey: randomUUID() },
        tx,
      );
      // 옛 손상 재현(inbound-origin-protection 스펙과 같다): ON_HAND < 입고 대기
      await tx.update(wmsTables.stockLedgers).set({ qty: 4 }).where(eq(wmsTables.stockLedgers.skuId, broken.skuId));
      const fine = await w.sku('A-01-01');
      await w.receive(fine.skuId, 5);

      const rows = await w.run(opts());

      expect(rows.find((r) => r.skuId === broken.skuId)).toMatchObject({ outcome: 'keep:inconsistent' });
      expect(rows.find((r) => r.skuId === fine.skuId)).toMatchObject({ outcome: 'moved', movedQty: 5 });
    });
  });

  it.each([
    ['Nest ConflictException', () => new ConflictException({ code: 'MOVEMENT_DESTINATION_INACTIVE' })],
    [
      '도메인 ConflictError(멱등키 충돌)',
      () => new ConflictError('idempotencyKey 재사용: MOVEMENT_DESTINATION_INACTIVE'),
    ],
  ])('한 SKU 의 MOVE 실패(%s)는 기록하고 다음 SKU 로 간다', async (_name, makeError) => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01');
      const a = await w.sku('A-01-01');
      const b = await w.sku('A-01-01');
      await w.receive(a.skuId, 3);
      await w.receive(b.skuId, 4);
      const real = makeMovementService(w.asDb);
      let first = true;
      const flaky = {
        moveImmediately: (dto: Parameters<MovementService['moveImmediately']>[0]) => {
          if (first) {
            first = false;
            return Promise.reject(makeError());
          }
          return real.moveImmediately(dto);
        },
      } as unknown as MovementService;

      const rows = await w.run(opts(), flaky);

      expect(rows.map((r) => r.outcome).sort()).toEqual(['failed', 'moved']);
      expect(rows.find((r) => r.outcome === 'failed')?.error).toMatch(/MOVEMENT_DESTINATION_INACTIVE|Conflict/);
    });
  });

  it('비활성 선반은 목적지가 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      await w.shelf('01', false);
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);

      const [row] = await w.run(opts());

      expect(row).toMatchObject({ outcome: 'keep:no-location' });
    });
  });

  it('옮긴 뒤 피킹 배정 후보는 그 선반이고 입고기본존은 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const shelfId = await w.shelf('01');
      const s = await w.sku('A-01-01');
      await w.receive(s.skuId, 10);

      await w.run(opts());
      const { capacities } = await lockSkuCapacities(tx, w.wiring.guard, w.warehouseId, [s.skuId]);

      const sources = capacities.filter((c) => c.remainingQty > 0).map((c) => c.sourceLocationId);
      expect(sources).toContain(shelfId);
      expect(sources).not.toContain(w.inboundId);
    });
  });
});
