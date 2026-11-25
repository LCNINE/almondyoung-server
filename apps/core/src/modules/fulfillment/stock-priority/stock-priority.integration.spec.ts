import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from '../services/__support__';
import { seedHandedOverOrder } from '../services/__support__/sellmate-handed-over-fixtures';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { WaitingOrdersReader } from '../reader/waiting-orders.reader';
import { loadStockGiven } from './stock-given';
import { StockPriorityManager } from './stock-priority.manager';
import { StockPriorityReader } from './stock-priority.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('재고 우선할당 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: StockPriorityReader;
  let manager: StockPriorityManager;
  let waiting: WaitingOrdersReader;
  const actor = { id: randomUUID(), roles: ['master'] };
  const reason = { reason: '', reasonCode: 'blocked_by_waiting_order' };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    reader = new StockPriorityReader(dbService);
    waiting = new WaitingOrdersReader(dbService);
    manager = new StockPriorityManager(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      reader,
      new AuditService(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  type World = { warehouseId: string; locationId: string; skuId: string };
  type Box = { shipmentId: string; lineId: string; fulfillmentOrderId: string };

  async function seedWorld(tx: DbTx, onHand: number): Promise<World> {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const world = { warehouseId, locationId, skuId };
    if (onHand > 0) await addStock(tx, world, onHand);
    return world;
  }

  async function addStock(tx: DbTx, world: World, qty: number, skuId = world.skuId) {
    const key = and(
      eq(wmsTables.stockLedgers.skuId, skuId),
      eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
      eq(wmsTables.stockLedgers.locationId, world.locationId),
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
    );
    const [existing] = await tx.select().from(wmsTables.stockLedgers).where(key);
    if (existing) {
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: existing.qty + qty })
        .where(key);
      return;
    }
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId: world.warehouseId,
      locationId: world.locationId,
      stockState: 'ON_HAND',
      qty,
    });
  }

  /** 주문 하나를 만들고 재고 대기 순번을 `at` 으로 맞춘다. */
  async function addOrder(tx: DbTx, world: World, items: { qty: number; skuId?: string }[], at: string): Promise<Box> {
    const lines = items.map((item) => ({
      variantId: randomUUID(),
      quantity: item.qty,
      skuId: item.skuId ?? world.skuId,
    }));
    const { salesOrderId } = await seedSalesOrder(tx, { lines });
    for (const line of lines) await seedMatching(tx, { variantId: line.variantId, skuId: line.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: world.warehouseId }, tx);
    const rows = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    const lineIds = rows.map((row) => row.lineId);
    await tx
      .update(wmsTables.shipmentLines)
      .set({ createdAt: new Date(at) })
      .where(inArray(wmsTables.shipmentLines.id, lineIds));
    await tx
      .update(wmsTables.stockReservations)
      .set({ requestedAt: new Date(at) })
      .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds));
    return rows[0];
  }

  async function reserved(tx: DbTx, box: Box): Promise<number> {
    const rows = await tx
      .select({ qty: wmsTables.stockReservations.quantity })
      .from(wmsTables.stockReservations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.stockReservations.shipmentLineId))
      .where(
        and(
          eq(wmsTables.shipmentLines.shipmentId, box.shipmentId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return rows.reduce((sum, row) => sum + row.qty, 0);
  }

  async function prioritize(tx: DbTx, box: Box, includeReady = false, key = randomUUID()) {
    const preview = await reader.preview(box.shipmentId, tx);
    const plan = includeReady ? preview.planWithReady : preview.plan;
    if (!plan) throw new Error(`no plan: ${preview.blocked}`);
    return manager.prioritize(box.shipmentId, { ...reason, planToken: plan.token, includeReady }, key, actor, tx);
  }

  async function retry(tx: DbTx, ...boxes: Box[]) {
    const ids = new Set(boxes.map((box) => box.lineId));
    for (const { id } of await wired.retryWorker.findCandidates(100_000, tx)) {
      if (ids.has(id)) await wired.retryWorker.retryOne(id, tx);
    }
  }

  it('먼저 온 큰 주문이 잡은 재고를 나중 온 주문으로 옮기고, 재시도가 돌아도 되돌아가지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const small = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      expect([await reserved(tx, big), await reserved(tx, small)]).toEqual([1, 0]);

      const preview = await reader.preview(small.shipmentId, tx);
      expect(preview.plan).toMatchObject({
        freeQty: 0,
        missingQty: 0,
        takes: [{ shipmentId: big.shipmentId, qty: 1, ready: false, emptied: true }],
      });

      const result = await prioritize(tx, small);
      expect(result).toMatchObject({ movedQty: 1, freeQty: 0, missingQty: 0 });
      await retry(tx, big, small);
      expect([await reserved(tx, big), await reserved(tx, small)]).toEqual([0, 1]);

      const fos = await tx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          status: wmsTables.fulfillmentOrders.status,
          mode: wmsTables.fulfillmentOrders.stockAllocation,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [big.fulfillmentOrderId, small.fulfillmentOrderId]));
      expect(fos.find((fo) => fo.id === small.fulfillmentOrderId)).toMatchObject({ status: 'ready', mode: 'priority' });
      expect(fos.find((fo) => fo.id === big.fulfillmentOrderId)).toMatchObject({ status: 'created', mode: 'normal' });
      const [bigLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, big.lineId));
      expect(bigLine.reservedQty).toBe(0);
    });
  });

  it('옮겨 온 예약은 남의 이른 순번을 물려받지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 2);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const small = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const whole = await addOrder(tx, world, [{ qty: 1 }], '2026-01-07T00:00:00Z');
      await prioritize(tx, small);
      // 남은 예약 행이 통째로 옮겨 간다
      await prioritize(tx, whole);

      const rows = await tx
        .select({
          lineId: wmsTables.stockReservations.shipmentLineId,
          at: wmsTables.stockReservations.requestedAt,
          qty: wmsTables.stockReservations.quantity,
        })
        .from(wmsTables.stockReservations)
        .where(
          and(
            inArray(wmsTables.stockReservations.shipmentLineId, [big.lineId, small.lineId, whole.lineId]),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(rows.find((row) => row.lineId === small.lineId)).toMatchObject({
        qty: 1,
        at: new Date('2026-01-05T00:00:00Z'),
      });
      expect(rows.find((row) => row.lineId === whole.lineId)).toMatchObject({
        qty: 1,
        at: new Date('2026-01-07T00:00:00Z'),
      });
      expect(rows).toHaveLength(2);
    });
  });

  it('모자라면 다음 재고를 먼저 받고, 취소하면 원래 순서로 돌아간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const first = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const urgent = await addOrder(tx, world, [{ qty: 3 }], '2026-01-05T00:00:00Z');
      expect(await prioritize(tx, urgent)).toMatchObject({ movedQty: 0, missingQty: 3 });

      await addStock(tx, world, 2);
      await retry(tx, first, urgent);
      expect([await reserved(tx, first), await reserved(tx, urgent)]).toEqual([0, 2]);

      await manager.cancel(urgent.shipmentId, { reason: '', reasonCode: 'no_longer_urgent' }, randomUUID(), actor, tx);
      await addStock(tx, world, 1);
      await retry(tx, first, urgent);
      expect([await reserved(tx, first), await reserved(tx, urgent)]).toEqual([1, 2]);
    });
  });

  it('우선할당 주문이 받을 몫은 새로 들어온 주문이 가로채지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const urgent = await addOrder(tx, world, [{ qty: 2 }], '2026-01-05T00:00:00Z');
      await prioritize(tx, urgent);
      await addStock(tx, world, 3);

      const fresh = await addOrder(tx, world, [{ qty: 3 }], '2026-01-06T00:00:00Z');
      expect(await reserved(tx, fresh)).toBe(1);
      await retry(tx, urgent, fresh);
      expect([await reserved(tx, urgent), await reserved(tx, fresh)]).toEqual([2, 1]);
    });
  });

  it('우선할당이 여럿이면 먼저 온 주문의 몫을 남겨 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const earlier = await addOrder(tx, world, [{ qty: 2 }], '2026-01-01T00:00:00Z');
      const later = await addOrder(tx, world, [{ qty: 2 }], '2026-01-05T00:00:00Z');
      await prioritize(tx, earlier);
      await addStock(tx, world, 3);

      expect((await reader.preview(earlier.shipmentId, tx)).plan).toMatchObject({ freeQty: 2, missingQty: 0 });
      expect((await reader.preview(later.shipmentId, tx)).plan).toMatchObject({ freeQty: 1, missingQty: 1 });
      await prioritize(tx, later);
      expect(await reserved(tx, later)).toBe(1);
      const order = (await wired.retryWorker.findCandidates(100_000, tx)).map((row) => row.id);
      const plain = await addOrder(tx, world, [{ qty: 1 }], '2025-12-01T00:00:00Z');
      const withPlain = (await wired.retryWorker.findCandidates(100_000, tx)).map((row) => row.id);
      expect(order.filter((id) => [earlier.lineId, later.lineId].includes(id))).toEqual([earlier.lineId, later.lineId]);
      expect(withPlain.filter((id) => [earlier.lineId, plain.lineId].includes(id))).toEqual([
        earlier.lineId,
        plain.lineId,
      ]);
      await retry(tx, earlier, later);
      expect([await reserved(tx, earlier), await reserved(tx, later)]).toEqual([2, 1]);
      // 우선할당 주문이 잡은 재고는 모자란 채여도 가져가지 않는다
      expect((await reader.preview(plain.shipmentId, tx)).plan).toMatchObject({ takes: [], missingQty: 1 });
    });
  });

  it('완전출고 상자는 그렇게 해야 다 채워질 때만 후보가 되고, 고를 때만 옮긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 2);
      const ready = await addOrder(tx, world, [{ qty: 2 }], '2026-01-01T00:00:00Z');
      const urgent = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const tooBig = await addOrder(tx, world, [{ qty: 9 }], '2026-01-06T00:00:00Z');

      const preview = await reader.preview(urgent.shipmentId, tx);
      expect(preview.plan).toMatchObject({ takes: [], missingQty: 1 });
      expect(preview.planWithReady).toMatchObject({
        missingQty: 0,
        takes: [{ shipmentId: ready.shipmentId, qty: 1, ready: true, emptied: false }],
      });
      expect(await reader.preview(tooBig.shipmentId, tx)).toMatchObject({
        planWithReady: null,
        held: [{ reason: 'ready', qty: 2 }],
      });
      expect(preview.held).toEqual([]);

      await prioritize(tx, urgent, true);
      expect([await reserved(tx, ready), await reserved(tx, urgent)]).toEqual([1, 1]);
    });
  });

  it('다른 줄이 모자란 상자는 이 상품을 다 잡았어도 못 나가는 상자로 본다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const { holderId } = await seedHolder(tx);
      const { skuId: none } = await seedSku(tx, holderId);
      const stuck = await addOrder(tx, world, [{ qty: 1 }, { qty: 1, skuId: none }], '2026-01-01T00:00:00Z');
      const urgent = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');

      expect((await reader.preview(urgent.shipmentId, tx)).plan).toMatchObject({
        missingQty: 0,
        takes: [{ shipmentId: stuck.shipmentId, ready: false }],
      });
    });
  });

  it('보던 사이 재고가 바뀌면 거절하고, 계획을 확정한 상자에서는 가져오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const small = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const { plan } = await reader.preview(small.shipmentId, tx);
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, big.shipmentId));

      await expect(
        manager.prioritize(small.shipmentId, { ...reason, planToken: plan?.token ?? '' }, randomUUID(), actor, tx),
      ).rejects.toMatchObject({ message: expect.stringContaining('plan changed') });
      expect((await reader.preview(small.shipmentId, tx)).plan).toMatchObject({ takes: [], missingQty: 1 });
    });
  });

  it('배치 작업 중인 상자는 주지도 받지도 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const small = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `stock-priority-${randomUUID()}`,
          warehouseId: world.warehouseId,
          pickingMethod: 'individual',
        })
        .returning();
      await tx.insert(wmsTables.outboundBatchWorkItems).values({ batchId: batch.id, shipmentId: big.shipmentId });

      expect((await reader.preview(small.shipmentId, tx)).plan).toMatchObject({ takes: [], missingQty: 1 });
      expect(await reader.preview(big.shipmentId, tx)).toMatchObject({ blocked: 'IN_BATCH' });
    });
  });

  it('이미 다 잡은 상자와 확정한 상자는 막는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const done = await addOrder(tx, world, [{ qty: 1 }], '2026-01-01T00:00:00Z');
      const planned = await addOrder(tx, world, [{ qty: 1 }], '2026-01-02T00:00:00Z');
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));

      expect(await reader.preview(done.shipmentId, tx)).toMatchObject({ blocked: 'NOTHING_MISSING', plan: null });
      expect(await reader.preview(planned.shipmentId, tx)).toMatchObject({ blocked: 'NOT_DRAFT' });
    });
  });

  it('다른 우선할당 주문에서는 가져오지 않고, 같은 요청을 다시 보내면 한 번만 옮긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 2);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const a = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const b = await addOrder(tx, world, [{ qty: 3 }], '2026-01-06T00:00:00Z');
      const key = randomUUID();
      const { plan } = await reader.preview(a.shipmentId, tx);
      const dto = { ...reason, planToken: plan?.token ?? '' };
      const once = await manager.prioritize(a.shipmentId, dto, key, actor, tx);
      const again = await manager.prioritize(a.shipmentId, dto, key, actor, tx);
      expect(again).toEqual(once);

      expect((await reader.preview(b.shipmentId, tx)).plan).toMatchObject({
        takes: [{ shipmentId: big.shipmentId, qty: 1 }],
        missingQty: 2,
      });
      expect([await reserved(tx, big), await reserved(tx, a)]).toEqual([1, 1]);
    });
  });

  it('받은 상자와 내준 상자의 작업 기록에 남고, 두 판매주문의 줄 상태가 바뀌었다고 표시한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const small = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const orders = await tx
        .select({ id: wmsTables.fulfillmentOrders.salesOrderId })
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [big.fulfillmentOrderId, small.fulfillmentOrderId]));
      const orderIds = orders.flatMap((order) => order.id ?? []);
      await tx
        .delete(wmsTables.salesOrderLineStateMarks)
        .where(inArray(wmsTables.salesOrderLineStateMarks.salesOrderId, orderIds));
      const { operationId } = await prioritize(tx, small);

      const marks = await tx
        .select({ id: wmsTables.salesOrderLineStateMarks.salesOrderId })
        .from(wmsTables.salesOrderLineStateMarks)
        .where(inArray(wmsTables.salesOrderLineStateMarks.salesOrderId, orderIds));
      expect(new Set(marks.map((mark) => mark.id))).toEqual(new Set(orderIds));
      const members = await tx
        .select({
          shipmentId: wmsTables.shipmentOperationMembers.shipmentId,
          role: wmsTables.shipmentOperationMembers.role,
        })
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, operationId));
      expect(members).toEqual(
        expect.arrayContaining([
          { shipmentId: small.shipmentId, role: 'target' },
          { shipmentId: big.shipmentId, role: 'source' },
        ]),
      );
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId));
      expect(operation).toMatchObject({
        type: 'stock_priority',
        status: 'completed',
        reasonCode: 'blocked_by_waiting_order',
      });
    });
  });

  it('못 옮기는 재고를 누가 잡고 있는지 — 다른 우선할당 주문과 송장·배치까지 간 상자를 나눠 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 3);
      const planned = await addOrder(tx, world, [{ qty: 1 }], '2026-01-01T00:00:00Z');
      const urgent = await addOrder(tx, world, [{ qty: 5 }], '2026-01-02T00:00:00Z');
      const late = await addOrder(tx, world, [{ qty: 1 }], '2026-01-03T00:00:00Z');
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, planned.shipmentId));
      await prioritize(tx, urgent);

      expect((await reader.preview(late.shipmentId, tx)).held).toEqual([
        { reason: 'priority', orderNos: [expect.any(String)], qty: 2 },
        { reason: 'in_progress', orderNos: [expect.any(String)], qty: 1 },
      ]);
      await manager.cancel(urgent.shipmentId, { reason: '', reasonCode: 'no_longer_urgent' }, randomUUID(), actor, tx);
      const after = await reader.preview(late.shipmentId, tx);
      expect(after.plan).toMatchObject({ missingQty: 0, takes: [{ shipmentId: urgent.shipmentId, qty: 1 }] });
      expect(after.held).toEqual([]);
    });
  });

  it('복구 중인 상자가 잡은 재고도 어디에 있는지 보인다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 1);
      const recovering = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const late = await addOrder(tx, world, [{ qty: 1 }], '2026-01-03T00:00:00Z');
      await tx
        .update(wmsTables.shipments)
        .set({ recoveryCode: 'CANCEL_REPLAN_PENDING' })
        .where(eq(wmsTables.shipments.id, recovering.shipmentId));

      expect((await reader.preview(late.shipmentId, tx)).held).toEqual([
        { reason: 'other', orderNos: [expect.any(String)], qty: 1 },
      ]);
    });
  });

  it('재고를 내준 상자마다 마지막으로 준 때와 받은 주문을 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 2);
      const big = await addOrder(tx, world, [{ qty: 5 }], '2026-01-01T00:00:00Z');
      const first = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      const second = await addOrder(tx, world, [{ qty: 1 }], '2026-01-06T00:00:00Z');
      await prioritize(tx, first);
      const { operationId } = await prioritize(tx, second);
      await tx
        .update(wmsTables.shipmentOperations)
        .set({ createdAt: new Date('2030-01-01T00:00:00Z') })
        .where(eq(wmsTables.shipmentOperations.id, operationId));

      const given = await loadStockGiven(tx, [big.shipmentId, first.shipmentId]);
      const [order] = await tx
        .select({ no: wmsTables.salesOrders.channelOrderId, display: wmsTables.salesOrders.displayOrderNo })
        .from(wmsTables.salesOrders)
        .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.salesOrderId, wmsTables.salesOrders.id))
        .where(eq(wmsTables.fulfillmentOrders.id, second.fulfillmentOrderId));
      expect(given).toEqual(
        new Map([[big.shipmentId, { at: new Date('2030-01-01T00:00:00Z'), orderNos: [order.display ?? order.no] }]]),
      );
    });
  });

  it('셀메이트에 넘긴 주문은 우선할당이었어도 먼저 받지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      const handedOver = await addOrder(tx, world, [{ qty: 2 }], '2026-01-05T00:00:00Z');
      await prioritize(tx, handedOver);
      const [order] = await tx
        .select({ id: wmsTables.fulfillmentOrders.salesOrderId })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, handedOver.fulfillmentOrderId));
      await seedHandedOverOrder(tx, order.id ?? '');
      await addStock(tx, world, 1);

      const fresh = await addOrder(tx, world, [{ qty: 1 }], '2026-01-01T00:00:00Z');
      expect(await reserved(tx, fresh)).toBe(1);
      const another = await addOrder(tx, world, [{ qty: 2 }], '2026-01-02T00:00:00Z');
      await addStock(tx, world, 1);
      const queue = (await wired.retryWorker.findCandidates(100_000, tx)).map((row) => row.id);
      expect(queue.filter((id) => [handedOver.lineId, another.lineId].includes(id))[0]).toBe(another.lineId);
    });
  });

  it('기다리는 주문은 우선할당 주문부터 채운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 0);
      await addOrder(tx, world, [{ qty: 2 }], '2026-01-01T00:00:00Z');
      const urgent = await addOrder(tx, world, [{ qty: 1 }], '2026-01-05T00:00:00Z');
      await prioritize(tx, urgent);
      await addStock(tx, world, 1);

      const [row] = await waiting.forSkus(world.warehouseId, [world.skuId], tx);
      expect(row).toMatchObject({ orders: 1, qty: 2 });
    });
  });
});
