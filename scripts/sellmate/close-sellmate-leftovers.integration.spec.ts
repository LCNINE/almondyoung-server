import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../../apps/core/src/modules/fulfillment/services/__support__';
import {
  seedBacklog,
  seedBox,
  seedFo,
  seedFullReservations,
  seedOrder,
  seedWorkItem,
  seedWorld,
  World,
} from '../../apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures';
import { FulfillmentOrderCreationBacklogService } from '../../apps/core/src/modules/fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { runLeftoverClose } from './close-sellmate-leftovers';

/**
 * 셀메이트 시기 자사몰 잔재 닫기(#1243). 롤백 트랜잭션 안에서만 돈다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'close-sellmate-leftovers\.integration\.spec\.ts$'
 * (로컬 core DB 의 마이그가 깨져 있으면 새 DB 를 만들어 마이그한 뒤 DATABASE_URL=… npx jest --runTestsByPath <이 파일> --runInBand)
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Dirty = string[];

function harness(tx: DbTx) {
  const dbService = makeDbService(tx as unknown as PostgresJsDatabase<typeof wmsSchema>);
  // closeOpenForSalesOrder 는 gate 를 쓰지 않는다 — 쓰기 시작하면 이 자리가 던진다.
  const gate = new Proxy(
    {},
    {
      get: () => {
        throw new Error('workflowGate 는 연결돼 있지 않다');
      },
    },
  );
  const backlog = new FulfillmentOrderCreationBacklogService(dbService, gate as never);
  const recalculated: string[][] = [];
  const sellable = {
    recalculateAndPublishForSkus: (skuIds: string[]) => {
      recalculated.push(skuIds);
      return Promise.resolve([]);
    },
  };
  return {
    run: (apply: boolean) => runLeftoverClose(dbService, { backlog, sellable: sellable as never }, { apply }),
    recalculated,
  };
}

/** 셀메이트로 나간 주문 하나: 판매주문 shipped · FO ready · draft 상자 · 확정 예약 · awaiting_matching 대기열 */
async function seedExternallyShipped(tx: DbTx, w: World, foStatus: 'ready' | 'processing' = 'ready') {
  const order = await seedOrder(tx, { status: 'shipped' });
  const fo = await seedFo(tx, w, order, { status: foStatus });
  const box = await seedBox(tx, w, [fo.foItemId], { status: 'draft' });
  await seedFullReservations(tx, w, { foId: fo.foId, foItemIds: [fo.foItemId], box });
  await seedBacklog(tx, order.salesOrderId, 'awaiting_matching');
  return { order, fo, box };
}

async function foStatus(tx: DbTx, foId: string) {
  const [row] = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
  return row.status;
}
async function boxStatus(tx: DbTx, shipmentId: string) {
  const [row] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
  return row.status;
}
async function backlogStatuses(tx: DbTx, salesOrderId: string) {
  const rows = await tx
    .select({ status: wmsTables.fulfillmentOrderCreationBacklogs.status })
    .from(wmsTables.fulfillmentOrderCreationBacklogs)
    .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
  return rows.map((r) => r.status);
}
async function reservationStatuses(tx: DbTx, lineIds: string[]) {
  const rows = await tx
    .select({ status: wmsTables.stockReservations.status })
    .from(wmsTables.stockReservations)
    .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds));
  return rows.map((r) => r.status);
}
async function dirtyMarks(tx: DbTx, salesOrderIds: string[]): Promise<Dirty> {
  const rows = await tx
    .select({ id: wmsTables.salesOrderLineStateMarks.salesOrderId })
    .from(wmsTables.salesOrderLineStateMarks)
    .where(inArray(wmsTables.salesOrderLineStateMarks.salesOrderId, salesOrderIds));
  return rows.map((r) => r.id);
}
async function handOver(tx: DbTx, salesOrderIds: string[]) {
  const [run] = await tx
    .insert(wmsTables.sellmateReconcileRuns)
    .values({
      kind: 'init',
      status: 'applied',
      inputSha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      inputSnapshotAt: new Date(),
    })
    .returning();
  for (const [i, salesOrderId] of salesOrderIds.entries()) {
    await tx.insert(wmsTables.sellmateHandedOverOrders).values({
      salesOrderId,
      displayId: 900000 + i,
      medusaOrderId: `order_${randomUUID()}`,
      runId: run.id,
    });
  }
}

describeIfDb('runLeftoverClose (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('셀메이트로 나간 주문의 FO·상자·예약·대기열을 닫고 줄 상태를 표시한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { order, fo, box } = await seedExternallyShipped(tx, w);
      const h = harness(tx);

      const report = await h.run(true);

      expect(await foStatus(tx, fo.foId)).toBe('shipped');
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fo.foItemId));
      expect(item.shippedQty).toBe(item.qty);
      expect(await boxStatus(tx, box.shipmentId)).toBe('shipped');
      expect(await reservationStatuses(tx, box.lineIds)).toEqual(['released']);
      expect(await backlogStatuses(tx, order.salesOrderId)).toEqual(['not_required']);
      expect(await dirtyMarks(tx, [order.salesOrderId])).toContain(order.salesOrderId);
      expect(report.releasedSkuIds).toContain(w.skuId);
      expect(h.recalculated.flat()).toContain(w.skuId);
      expect(report.closedFo).toBeGreaterThanOrEqual(1);
      expect(report.closedShipments).toBeGreaterThanOrEqual(1);
      expect(report.releasedReservations).toBeGreaterThanOrEqual(1);
      expect(report.closedBacklogs).toBeGreaterThanOrEqual(1);
    });
  });

  it('dry-run 은 같은 건수를 내고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { order, fo, box } = await seedExternallyShipped(tx, w);
      const h = harness(tx);

      const dry = await h.run(false);

      expect(await foStatus(tx, fo.foId)).toBe('ready');
      expect(await boxStatus(tx, box.shipmentId)).toBe('draft');
      expect(await reservationStatuses(tx, box.lineIds)).toEqual(['confirmed']);
      expect(await backlogStatuses(tx, order.salesOrderId)).toEqual(['awaiting_matching']);
      expect(await dirtyMarks(tx, [order.salesOrderId])).toEqual([]);
      expect(h.recalculated).toEqual([]);

      const applied = await h.run(true);
      expect(applied).toEqual({ ...dry });
    });
  });

  it('다시 돌리면 닫을 게 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      await seedExternallyShipped(tx, w);
      const h = harness(tx);

      await h.run(true);
      const again = await h.run(true);

      expect(again).toMatchObject({ closedFo: 0, closedShipments: 0, releasedReservations: 0, closedBacklogs: 0 });
      expect(again.releasedSkuIds).toEqual([]);
    });
  });

  it('앱이 출고할 주문(confirmed)과 마켓 주문은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const app = await seedOrder(tx, { status: 'confirmed' });
      const appFo = await seedFo(tx, w, app, { status: 'ready' });
      const appBox = await seedBox(tx, w, [appFo.foItemId], { status: 'draft' });
      await seedBacklog(tx, app.salesOrderId, 'awaiting_matching');
      const market = await seedExternallyShipped(tx, w);
      await tx
        .update(wmsTables.salesOrders)
        .set({ salesChannel: 'naver' })
        .where(eq(wmsTables.salesOrders.id, market.order.salesOrderId));

      await harness(tx).run(true);

      expect(await foStatus(tx, appFo.foId)).toBe('ready');
      expect(await boxStatus(tx, appBox.shipmentId)).toBe('draft');
      expect(await backlogStatuses(tx, app.salesOrderId)).toEqual(['awaiting_matching']);
      expect(await foStatus(tx, market.fo.foId)).toBe('ready');
      expect(await boxStatus(tx, market.box.shipmentId)).toBe('draft');
      expect(await backlogStatuses(tx, market.order.salesOrderId)).toEqual(['awaiting_matching']);
    });
  });

  it('FO 없이 대기열만 남은 외부 출고 주문은 대기열만 닫는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const order = await seedOrder(tx, { status: 'shipped' });
      await seedBacklog(tx, order.salesOrderId, 'awaiting_matching');

      await harness(tx).run(true);

      expect(await backlogStatuses(tx, order.salesOrderId)).toEqual(['not_required']);
    });
  });

  it('취소 주문은 대기열만 닫고 열린 FO·상자는 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const order = await seedOrder(tx, { status: 'cancelled' });
      const fo = await seedFo(tx, w, order, { status: 'ready' });
      const box = await seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await seedBacklog(tx, order.salesOrderId, 'pending');

      const report = await harness(tx).run(true);

      expect(await backlogStatuses(tx, order.salesOrderId)).toEqual(['not_required']);
      expect(await foStatus(tx, fo.foId)).toBe('ready');
      expect(await boxStatus(tx, box.shipmentId)).toBe('draft');
      const [so] = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
      expect(report.cancelledOpen).toContain(so.channelOrderId);
    });
  });

  it('FO 가 사람이 볼 상태면 그 주문은 건드리지 않고 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { order, fo, box } = await seedExternallyShipped(tx, w, 'processing');

      const report = await harness(tx).run(true);

      expect(await foStatus(tx, fo.foId)).toBe('processing');
      expect(await boxStatus(tx, box.shipmentId)).toBe('draft');
      expect(await backlogStatuses(tx, order.salesOrderId)).toEqual(['awaiting_matching']);
      const [so] = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
      expect(report.humanFo).toContain(so.channelOrderId);
    });
  });

  it('앱 주문과 섞인 상자는 닫지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const shipped = await seedOrder(tx, { status: 'shipped' });
      const shippedFo = await seedFo(tx, w, shipped, { status: 'ready' });
      const app = await seedOrder(tx, { status: 'confirmed' });
      const appFo = await seedFo(tx, w, app, { status: 'ready' });
      const box = await seedBox(tx, w, [shippedFo.foItemId, appFo.foItemId], { status: 'draft' });
      await seedFullReservations(tx, w, {
        foId: appFo.foId,
        foItemIds: [appFo.foItemId],
        box: { lineIds: [box.lineIds[1]] },
      });

      await harness(tx).run(true);

      expect(await foStatus(tx, shippedFo.foId)).toBe('shipped');
      expect(await boxStatus(tx, box.shipmentId)).toBe('draft');
      expect(await reservationStatuses(tx, [box.lineIds[1]])).toEqual(['confirmed']);
    });
  });

  it('진행 중 작업 항목이 걸린 상자는 닫지 않고 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const { box } = await seedExternallyShipped(tx, w);
      await seedWorkItem(tx, w, box.shipmentId, { status: 'picking' });

      const report = await harness(tx).run(true);

      expect(await boxStatus(tx, box.shipmentId)).toBe('draft');
      expect(await reservationStatuses(tx, box.lineIds)).toEqual(['confirmed']);
      expect(report.activeWorkShipments).toContain(box.shipmentId);
    });
  });

  it('recovery_required 상자는 닫지 않고 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const order = await seedOrder(tx, { status: 'shipped' });
      const fo = await seedFo(tx, w, order, { status: 'ready' });
      const box = await seedBox(tx, w, [fo.foItemId], { status: 'recovery_required', recoveryCode: 'TEST' });

      const report = await harness(tx).run(true);

      expect(await boxStatus(tx, box.shipmentId)).toBe('recovery_required');
      expect(report.recoveryShipments).toContain(box.shipmentId);
    });
  });

  it('드레인 미완료는 넘긴 주문 중 아직 안 나간 것을 센다 — 넘긴 주문이 없으면 null', async () => {
    await inRollbackTx(db, async (tx) => {
      const h = harness(tx);
      expect((await h.run(false)).drainIncomplete).toBeNull();

      const out = await seedOrder(tx, { status: 'shipped' });
      const waiting = await seedOrder(tx, { status: 'confirmed' });
      await handOver(tx, [out.salesOrderId, waiting.salesOrderId]);

      expect((await h.run(false)).drainIncomplete).toBe(1);
    });
  });
});
