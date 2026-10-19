import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../services/__support__';
import {
  Actor,
  createBatchWithShipments,
  Database,
  makeServices,
  seedRegisteredWaybills,
  seedWorld,
  WarehouseWorld,
} from '../services/__support__/outbound-v2-warehouse-harness';

/**
 * K1b-1 특성 테스트 — 세 전략의 `unpickShipment`·전략 `handoff` 가 «지금» 하는 일을 실제 DB 로 기록한다.
 * K1b-2 가 세 본문을 한 벌로 합칠 때 이 파일은 설계 §5.4 의 D1·D3 표 행만 바뀐다. 나머지가 빨개지면 동작이 바뀐 것이다.
 *
 * 깨진 상태는 같은 tx 안에서 `batch_inventory_session_balances.custody_ref` 를 직접 UPDATE 해서 만든다.
 * 수량과 grain(session·sku·source·line) 은 그대로 둔다.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type StrategyName = 'discrete' | 'pick_to_tote' | 'aggregate_then_sort';

const STRATEGIES: Array<[StrategyName]> = [['discrete'], ['pick_to_tote'], ['aggregate_then_sort']];

const PICKING_METHOD = {
  discrete: 'individual',
  pick_to_tote: 'multi_order',
  aggregate_then_sort: 'total_picking',
} as const satisfies Record<StrategyName, 'individual' | 'multi_order' | 'total_picking'>;

/** 피커가 지금 들고 있는 자리(전략별 custody). */
const HELD_CUSTODY = {
  discrete: 'WORKER',
  pick_to_tote: 'TOTE',
  aggregate_then_sort: 'SORTING',
} as const satisfies Record<StrategyName, 'WORKER' | 'TOTE' | 'SORTING'>;

/** 박스 하나, 라인 하나, 배정 수량 2. */
const LINE_QTY = 2;

interface Picked {
  strategy: StrategyName;
  world: WarehouseWorld;
  services: ReturnType<typeof makeServices>;
  manager: Actor;
  worker: Actor;
  batchId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  /** 피커 클레임 직후의 리스 버전(`toPicking` 이 돌려줄 때 DB 의 값). */
  leaseVersion: number;
  heldQty: number;
  toteIds: string[];
}

async function expectConflict(promise: Promise<unknown>, expected: { code: string; message: string }) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConflictException);
  if (!(error instanceof ConflictException)) return;
  expect(error.getResponse()).toMatchObject(expected);
}

describeIfDb('피킹 되돌림 특성 테스트 (K1b-1) — 세 전략의 지금 동작', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  /**
   * 배정 몫(`scanQty`, 기본 전부)을 스캔한 상태 — `completePick` 직전이다.
   * discrete 는 `scan`, tote 는 `assignTote` + `toteScan`, aggregate 는 `bulkCartScan` + `sortScan(SORTING)`.
   */
  async function toPicking(tx: DbTx, strategy: StrategyName, scanQty = LINE_QTY): Promise<Picked> {
    const world = await seedWorld(tx, [LINE_QTY], [strategy]);
    await seedRegisteredWaybills(tx, world);
    const services = makeServices(db, tx);
    const manager = { id: randomUUID(), roles: ['master'] };
    const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
    const member = world.shipments[0];
    const { batch, added } = await createBatchWithShipments(
      services,
      world,
      manager,
      PICKING_METHOD[strategy],
      strategy === 'pick_to_tote' ? 4 : undefined,
    );
    const workItemId = added[0].workItem.id;
    const claim = await services.batches.claimPicker(
      workItemId,
      { expectedLeaseVersion: 0 },
      `char-claim-${randomUUID()}`,
      worker,
    );
    const leaseVersion = claim.workItem.leaseVersion;
    const started = await services.picking.start({
      batchId: batch.batchId,
      actorId: worker.id,
      idempotencyKey: `char-start-${randomUUID()}`,
    });
    expect(started.state).toBe('started');
    const sessionId = started.sessionId;
    const toteIds: string[] = [];

    if (strategy === 'discrete') {
      await services.picking.scan({
        strategy: 'discrete',
        stage: 'source',
        batchId: batch.batchId,
        sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        shipmentLineId: member.line.id,
        skuId: world.skuId,
        sourceLocationId: world.locationId,
        quantity: scanQty,
        actor: worker,
        expectedLeaseVersion: leaseVersion,
        idempotencyKey: `char-scan-${randomUUID()}`,
      });
    } else if (strategy === 'pick_to_tote') {
      const toteBarcode = `TOTE-CHAR-${randomUUID()}`;
      const registered = await services.picking.registerTote({
        warehouseId: world.warehouseId,
        toteBarcode,
        actor: worker,
        idempotencyKey: `char-tote-register-${randomUUID()}`,
      });
      toteIds.push(registered.toteId);
      await services.picking.assignTote({
        batchId: batch.batchId,
        sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        toteBarcode,
        actor: worker,
        expectedLeaseVersion: leaseVersion,
        idempotencyKey: `char-tote-assign-${randomUUID()}`,
      });
      await services.picking.toteScan({
        strategy: 'pick_to_tote',
        stage: 'source',
        batchId: batch.batchId,
        sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        shipmentLineId: member.line.id,
        skuId: world.skuId,
        sourceLocationId: world.locationId,
        quantity: scanQty,
        toteBarcode,
        actor: worker,
        expectedLeaseVersion: leaseVersion,
        idempotencyKey: `char-tote-scan-${randomUUID()}`,
      });
    } else {
      const cartId = `cart-${randomUUID()}`;
      await services.picking.aggregateBulkCartScan({
        strategy: 'aggregate_then_sort',
        stage: 'bulk_collect',
        batchId: batch.batchId,
        sessionId,
        skuId: world.skuId,
        sourceLocationId: world.locationId,
        quantity: scanQty,
        cartId,
        actor: worker,
        idempotencyKey: `char-collect-${randomUUID()}`,
      });
      await services.picking.aggregateSortScan({
        strategy: 'aggregate_then_sort',
        stage: 'sort',
        batchId: batch.batchId,
        sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        shipmentLineId: member.line.id,
        skuId: world.skuId,
        cartId,
        quantity: scanQty,
        destinationCustody: 'SORTING',
        actor: worker,
        expectedLeaseVersion: leaseVersion,
        idempotencyKey: `char-sort-${randomUUID()}`,
      });
    }

    return {
      strategy,
      world,
      services,
      manager,
      worker,
      batchId: batch.batchId,
      sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      shipmentLineId: member.line.id,
      leaseVersion,
      heldQty: scanQty,
      toteIds,
    };
  }

  /** `toPicking` + `completePick`. 돌려주는 `leaseVersion` 은 완료 뒤 DB 의 값이다. */
  async function toReadyToPack(tx: DbTx, strategy: StrategyName): Promise<Picked> {
    const picked = await toPicking(tx, strategy);
    const completed = await picked.services.picking.completePick({
      batchId: picked.batchId,
      sessionId: picked.sessionId,
      workItemId: picked.workItemId,
      shipmentId: picked.shipmentId,
      actor: picked.worker,
      expectedLeaseVersion: picked.leaseVersion,
      idempotencyKey: `char-complete-${randomUUID()}`,
    });
    expect(completed).toMatchObject({ custodyType: 'PACKING', totalQty: LINE_QTY });
    const item = await loadWorkItemRow(tx, picked.workItemId);
    expect(item.status).toBe('ready_to_pack');
    return { ...picked, leaseVersion: item.leaseVersion };
  }

  async function loadWorkItemRow(tx: DbTx, workItemId: string) {
    const [item] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
    return item;
  }

  async function lineBalances(tx: DbTx, picked: Picked) {
    return tx
      .select({
        id: wmsTables.batchInventorySessionBalances.id,
        custodyType: wmsTables.batchInventorySessionBalances.custodyType,
        custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
        qty: wmsTables.batchInventorySessionBalances.qty,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, picked.shipmentLineId),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .orderBy(wmsTables.batchInventorySessionBalances.id);
  }

  async function atSourceQty(tx: DbTx, picked: Picked): Promise<number> {
    const [row] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId),
          eq(wmsTables.batchInventorySessionBalances.skuId, picked.world.skuId),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
        ),
      );
    return Number(row?.qty ?? 0);
  }

  /** 그 박스 라인의 `custodyType` 잔량 1행의 ref 만 바꾼다(수량·grain 불변). 바꾼 잔량 id 를 돌려준다. */
  async function rewriteCustodyRef(
    tx: DbTx,
    picked: Picked,
    custodyType: 'WORKER' | 'TOTE' | 'SORTING' | 'PACKING',
    custodyRef: string,
  ): Promise<string> {
    const updated = await tx
      .update(wmsTables.batchInventorySessionBalances)
      .set({ custodyRef })
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, picked.shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.custodyType, custodyType),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .returning({ id: wmsTables.batchInventorySessionBalances.id });
    expect(updated).toHaveLength(1);
    return updated[0].id;
  }

  /** `picking` 상태의 깨진 자리 — 피커가 아닌 다른 holder. */
  function foreignHeldRef(picked: Picked): string {
    if (picked.strategy === 'discrete') return randomUUID();
    if (picked.strategy === 'pick_to_tote') return `tote:${randomUUID()}`;
    return `sorting:${picked.workItemId}:other`;
  }

  function unpick(picked: Picked, actor: Actor, idempotencyKey = `char-unpick-${randomUUID()}`) {
    return picked.services.picking.unpickShipment({
      batchId: picked.batchId,
      sessionId: picked.sessionId,
      workItemId: picked.workItemId,
      shipmentId: picked.shipmentId,
      actor,
      expectedLeaseVersion: picked.leaseVersion,
      idempotencyKey,
    });
  }

  /** 되돌림 성공 뒤 공통 기록: 작업 항목 queued·리스+1·만료 없음, 라인 잔량 전부 AT_SOURCE, tote 는 배정 해제·available. */
  async function expectRequeuedWithEverythingAtSource(tx: DbTx, picked: Picked, atSourceBefore: number) {
    const item = await loadWorkItemRow(tx, picked.workItemId);
    expect(item).toMatchObject({ status: 'queued', leaseVersion: picked.leaseVersion + 1, leaseExpiresAt: null });
    const held = (await lineBalances(tx, picked)).filter((balance) => balance.custodyType !== 'AT_SOURCE');
    expect(held).toHaveLength(0);
    expect(await atSourceQty(tx, picked)).toBe(atSourceBefore + picked.heldQty);
    if (picked.strategy === 'pick_to_tote') {
      const assignments = await tx
        .select({ releasedAt: wmsTables.shipmentToteAssignments.releasedAt })
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.shipmentId, picked.shipmentId));
      expect(assignments).toHaveLength(picked.toteIds.length);
      expect(assignments.every((assignment) => assignment.releasedAt !== null)).toBe(true);
      for (const toteId of picked.toteIds) {
        const [tote] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, toteId));
        expect(tote.status).toBe('available');
      }
    }
  }

  describe.each(STRATEGIES)('%s', (strategy) => {
    it('unpick in picking by the active picker returns every held unit to AT_SOURCE and requeues', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toPicking(tx, strategy);
        const before = await atSourceQty(tx, picked);

        const result = await unpick(picked, picked.worker);

        expect(result).toMatchObject({
          workItemId: picked.workItemId,
          shipmentId: picked.shipmentId,
          status: 'queued',
          returnedToSourceQty: LINE_QTY,
        });
        await expectRequeuedWithEverythingAtSource(tx, picked, before);
      });
    });

    it('unpick in ready_to_pack by the previous picker succeeds the same way', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toReadyToPack(tx, strategy);
        const before = await atSourceQty(tx, picked);

        const result = await unpick(picked, picked.worker);

        expect(result).toMatchObject({ status: 'queued', returnedToSourceQty: LINE_QTY });
        await expectRequeuedWithEverythingAtSource(tx, picked, before);
      });
    });

    it('unpick in ready_to_pack by a logistics_manager who did not pick succeeds', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toReadyToPack(tx, strategy);
        const before = await atSourceQty(tx, picked);
        const logisticsManager = { id: randomUUID(), roles: ['logistics_manager'] };

        const result = await unpick(picked, logisticsManager);

        expect(result).toMatchObject({ status: 'queued', returnedToSourceQty: LINE_QTY });
        await expectRequeuedWithEverythingAtSource(tx, picked, before);
      });
    });

    it('unpick in ready_to_pack by another non-manager worker is PICKING_UNPICK_FORBIDDEN', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toReadyToPack(tx, strategy);
        const otherWorker = { id: randomUUID(), roles: ['warehouse_worker'] };

        await expectConflict(unpick(picked, otherWorker), {
          code: 'PICKING_UNPICK_FORBIDDEN',
          message: 'Only the previous picker or a manager may unpick',
        });
        expect((await loadWorkItemRow(tx, picked.workItemId)).status).toBe('ready_to_pack');
      });
    });

    it('unpick in picking with custody moved to another holder is PICKING_CUSTODY_OWNER_MISMATCH', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toPicking(tx, strategy);
        const balanceId = await rewriteCustodyRef(tx, picked, HELD_CUSTODY[strategy], foreignHeldRef(picked));

        const message = {
          discrete: 'Active pick custody must be held only by the current picker',
          pick_to_tote: 'Active pick custody must be held only by totes assigned to the shipment',
          aggregate_then_sort: `Balance ${balanceId} has unexpected custody`,
        }[strategy];
        await expectConflict(unpick(picked, picked.worker), { code: 'PICKING_CUSTODY_OWNER_MISMATCH', message });
        expect((await loadWorkItemRow(tx, picked.workItemId)).status).toBe('picking');
      });
    });

    it('unpick replayed with the same idempotency key returns the stored response and moves nothing twice', async () => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toPicking(tx, strategy);
        const before = await atSourceQty(tx, picked);
        const key = `char-unpick-replay-${randomUUID()}`;

        const first = await unpick(picked, picked.worker, key);
        const second = await unpick(picked, picked.worker, key);

        expect(second.operationId).toBe(first.operationId);
        expect(second).toEqual(first);
        expect(await atSourceQty(tx, picked)).toBe(before + LINE_QTY);
        const item = await loadWorkItemRow(tx, picked.workItemId);
        expect(item).toMatchObject({ status: 'queued', leaseVersion: picked.leaseVersion + 1 });
      });
    });
  });

  /**
   * 설계 D3 — K1b-2 에서 aggregate_then_sort 행만 `PICKING_PACKING_CUSTODY_INCOMPLETE` 로 바뀐다.
   * aggregate 는 지금 grain 루프 안에서 잔량마다 소유자를 검사하므로 남의 PACKING 이 OWNER_MISMATCH 로 먼저 걸린다.
   */
  describe('unpick in ready_to_pack with packing custody under another work item', () => {
    const READY_TO_PACK_FOREIGN_PACKING: Array<[StrategyName, string, (balanceId: string) => string]> = [
      [
        'discrete',
        'PICKING_PACKING_CUSTODY_INCOMPLETE',
        () => 'Ready-to-pack custody must exactly match every work item allocation',
      ],
      [
        'pick_to_tote',
        'PICKING_PACKING_CUSTODY_INCOMPLETE',
        () => 'Ready-to-pack custody must exactly match every work item allocation',
      ],
      [
        'aggregate_then_sort',
        'PICKING_CUSTODY_OWNER_MISMATCH',
        (balanceId) => `Balance ${balanceId} has unexpected custody`,
      ],
    ];

    it.each(READY_TO_PACK_FOREIGN_PACKING)('%s → %s', async (strategy, code, messageFor) => {
      await inRollbackTx(db, async (tx) => {
        const picked = await toReadyToPack(tx, strategy);
        const foreignPackingRef = `work-item:${randomUUID()}`;
        const balanceId = await rewriteCustodyRef(tx, picked, 'PACKING', foreignPackingRef);

        await expectConflict(unpick(picked, picked.worker), { code, message: messageFor(balanceId) });
        const item = await loadWorkItemRow(tx, picked.workItemId);
        expect(item).toMatchObject({ status: 'ready_to_pack', leaseVersion: picked.leaseVersion });
        expect(await lineBalances(tx, picked)).toEqual([
          { id: balanceId, custodyType: 'PACKING', custodyRef: foreignPackingRef, qty: LINE_QTY },
        ]);
      });
    });
  });
});
