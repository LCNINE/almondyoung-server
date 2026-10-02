import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { inRollbackTx, makeDb } from './__support__';
import { seedShortPickOperation, seedSpareStock } from './__support__/short-pick-fixtures';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('BoxAllocationManager — 결품 (스펙 §9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 하나(A 3개, 픽스처 로케이션 L1 재고 3)를 시작하고 1개를 집는다. */
  async function startedWithOnePicked(tx: DbTx) {
    const box = await seedPickableShipment(tx, 3);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `pick-${randomUUID()}`,
        actorId: box.actorId,
        quantity: 1,
        from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: box.skuId,
          sourceLocationId: box.locationId,
          custodyType: 'WORKER',
          custodyRef: box.actorId,
          shipmentLineId: box.shipmentLineId,
        },
      },
      tx,
    );
    const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
    if (!session) throw new Error('session missing');
    const operation = await seedShortPickOperation(tx, {
      shipmentId: box.shipmentId,
      workItemId: box.workItemId,
      sessionId: session.id,
      actorId: box.actorId,
      lines: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 2, allocationQty: 3 }],
    });
    const plan = (qty: number) =>
      wiring.boxes.planShortages(
        {
          session,
          workItemId: box.workItemId,
          shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty }],
        },
        tx,
      );
    const approve = async (qty: number) => {
      const planned = await plan(qty);
      await wiring.boxes.approveShortages(
        {
          session,
          workItemId: box.workItemId,
          shortPickOperationId: operation.id,
          actorId: box.actorId,
          reasonCode: 'MISSING',
          reason: operation.reason,
          planned,
        },
        tx,
      );
      return planned;
    };
    return { box, wiring, session, operation, plan, approve };
  }

  const allocationsOf = (tx: DbTx, workItemId: string) =>
    tx
      .select({
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));

  it('안 집은 몫을 넘는 결품은 SHORT_PICK_EXCEEDS_UNPICKED — 판정 단계에서 전부 보고하고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, plan } = await startedWithOnePicked(tx);
      const error = await plan(3).catch((e: unknown) => e);
      expect(error).toMatchObject({
        response: {
          code: 'SHORT_PICK_EXCEEDS_UNPICKED',
          errors: [
            { shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, requestedQty: 3, unpickedQty: 2 },
          ],
        },
      });
      expect(await allocationsOf(tx, box.workItemId)).toEqual([{ sourceLocationId: box.locationId, qty: 3 }]);
    });
  });

  it('부족 승인은 배정을 같은 수만큼 줄이고, 재배정은 결품 로케이션을 빼고 다른 로케이션에서 채운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, session, approve } = await startedWithOnePicked(tx);
      const spare = await seedSpareStock(tx, box, 5);
      const approved = await approve(2);
      expect(approved).toEqual([
        expect.objectContaining({ sourceLocationId: box.locationId, allocationQty: 3, qty: 2 }),
      ]);
      // 부족 승인 뒤 L1 에는 유령 재고 2 가 일반 가용으로 보인다 — 후보에서 빠져야 한다.
      const phantom = await new BatchControlledStockGuard().getAvailability(
        { skuId: box.skuId, warehouseId: box.warehouseId, sourceLocationId: box.locationId },
        tx,
      );
      expect(phantom.generallyAvailableQty).toBe(2);

      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      expect(plan.shortages).toEqual([]);
      expect(plan.handIns).toEqual([expect.objectContaining({ sourceLocationId: spare.locationId, qty: 2 })]);
      const refills = await wiring.boxes.applyRefill(
        {
          session,
          batchId: box.batchId,
          actorId: box.actorId,
          operationId: randomUUID(),
          plan,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId }],
        },
        tx,
      );
      expect(refills).toEqual([
        {
          shipmentLineId: box.shipmentLineId,
          skuId: box.skuId,
          sourceLocationId: spare.locationId,
          locationCode: spare.code,
          qty: 2,
        },
      ]);
      expect(await allocationsOf(tx, box.workItemId)).toEqual(
        expect.arrayContaining([
          { sourceLocationId: box.locationId, qty: 1 },
          { sourceLocationId: spare.locationId, qty: 2 },
        ]),
      );
      await expect(wiring.recovery.reconcile(session.id, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('결품 로케이션 말고 재고가 없으면 채우지 못한다(STOCK_SHORT) — 유령 재고는 후보가 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, session, approve } = await startedWithOnePicked(tx);
      await approve(2);
      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      expect(plan.handIns).toEqual([]);
      expect(plan.shortages).toEqual([
        expect.objectContaining({ shipmentLineId: box.shipmentLineId, shortQty: 2, reason: 'STOCK_SHORT' }),
      ]);
    });
  });

  it('이미 배정 행이 있는 로케이션으로 채우면 그 행을 늘린다(source_stock_version 그대로) — 복구 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 3);
      // L1 2 + 여분 2 → 한 곳 전량 불가(E8) → 코드 순으로 L1 2 · 여분 1 로 나눈다.
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 2 })
        .where(eq(wmsTables.stockLedgers.locationId, box.locationId));
      const spare = await seedSpareStock(tx, box, 2);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start(
        { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
      if (!session) throw new Error('session missing');
      const [spareRow] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.sourceLocationId, spare.locationId));
      expect(spareRow).toMatchObject({ qty: 1 });
      const operation = await seedShortPickOperation(tx, {
        shipmentId: box.shipmentId,
        workItemId: box.workItemId,
        sessionId: session.id,
        actorId: box.actorId,
        lines: [
          { shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 1, allocationQty: 2 },
        ],
      });
      const planned = await wiring.boxes.planShortages(
        {
          session,
          workItemId: box.workItemId,
          shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty: 1 }],
        },
        tx,
      );
      await wiring.boxes.approveShortages(
        {
          session,
          workItemId: box.workItemId,
          shortPickOperationId: operation.id,
          actorId: box.actorId,
          reasonCode: 'MISSING',
          reason: operation.reason,
          planned,
        },
        tx,
      );
      const plan = await wiring.boxes.planRefill(
        {
          session,
          warehouseId: box.warehouseId,
          workItemId: box.workItemId,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId, qty: 3 }],
          excludedSources: [{ skuId: box.skuId, sourceLocationId: box.locationId }],
        },
        tx,
      );
      await wiring.boxes.applyRefill(
        {
          session,
          batchId: box.batchId,
          actorId: box.actorId,
          operationId: randomUUID(),
          plan,
          lines: [{ id: box.shipmentLineId, skuId: box.skuId }],
        },
        tx,
      );
      const [grown] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.id, spareRow.id));
      expect(grown).toMatchObject({ qty: 2, sourceStockVersion: spareRow.sourceStockVersion });
      await expect(wiring.recovery.reconcile(session.id, tx)).resolves.toMatchObject({ healthy: true });
    });
  });
});
