import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from '../picking/allocation/batch-start';
import { STRATEGY_BY_PICKING_METHOD } from '../picking/picking-method.contract';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedLooseBox, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('시작된 배치에 합류 (스펙 §7)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 둘(2·1개)이 시작된 배치 + 같은 재고 위의 떠 있는 박스. 재고 기본 10. */
  async function startedBatchWithLooseBox(tx: DbTx, looseQty = 3, stockQty = 10) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, stockQty);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const loose = await seedLooseBox(tx, first, looseQty);
    return { first, second, loose, wiring, sessionId: started.sessionId };
  }

  const allocationsOf = (tx: DbTx, workItemIds: string[]) =>
    tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(inArray(wmsTables.pickingSourceAllocations.workItemId, workItemIds));
  const sessionOf = async (tx: DbTx, sessionId: string) =>
    (
      await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, sessionId))
    )[0];

  it('그 박스만 배정·인계하고 다른 박스의 배정은 그대로다 — 복구 healthy, 불변식 통과', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      const othersBefore = await allocationsOf(tx, [first.workItemId, second.workItemId]);

      const joined = await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      expect(joined.workItem).toMatchObject({ batchId: first.batchId, shipmentId: loose.shipmentId, status: 'queued' });
      const own = await allocationsOf(tx, [joined.workItem.id]);
      expect(own.map((row) => [row.shipmentLineId, row.sourceLocationId, row.qty])).toEqual([
        [loose.shipmentLineId, loose.locationId, 3],
      ]);
      expect(await allocationsOf(tx, [first.workItemId, second.workItemId])).toEqual(othersBefore);
      const session = await sessionOf(tx, sessionId);
      expect(session.handedInQty).toBe(6);
      const handIns = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      const joinEvent = handIns.find((event) => event.idempotencyKey.startsWith('hand-in:'));
      expect(joinEvent?.payload).toMatchObject({
        batchId: first.batchId,
        workItemId: joined.workItem.id,
        allocationId: own[0].id,
      });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId, loose.shipmentId]);
    });
  });

  it('다른 박스의 송장 지문은 변하지 않고, 합류한 박스는 출력 전(never_printed)이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      await promoteToCarrierWaybill(tx, first);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const loose = await seedLooseBox(tx, first, 2);
      await promoteToCarrierWaybill(tx, loose);
      const labels = assembleLabels(ambientDbService(tx));
      const before = await labels.assembler.current(first.shipmentId, tx);

      await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      const after = await labels.assembler.current(first.shipmentId, tx);
      expect(
        after.kind === 'printable' && before.kind === 'printable' && after.fingerprint === before.fingerprint,
      ).toBe(true);
      await expect(labels.states.forShipment(loose.shipmentId, tx)).resolves.toMatchObject({ state: 'never_printed' });
    });
  });

  it('재고가 모자라면 BATCH_JOIN_BLOCKED(STOCK_SHORT) 이고 작업 항목·배정·인계가 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx, 3, 5); // 일반 가용 5 − 3 = 2
      const sessionBefore = await sessionOf(tx, sessionId);

      await expect(
        tx.transaction((trx) =>
          wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx),
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'BATCH_JOIN_BLOCKED',
          errors: [
            expect.objectContaining({
              shipmentId: loose.shipmentId,
              reason: 'STOCK_SHORT',
              requiredQty: 3,
              shortQty: 1,
            }),
          ],
        },
      });

      const items = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, loose.shipmentId));
      expect(items).toEqual([]);
      expect(await sessionOf(tx, sessionId)).toEqual(sessionBefore);
    });
  });

  it('송장이 쓸 수 없고 재고도 모자라면 사유를 둘 다 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring } = await startedBatchWithLooseBox(tx, 3, 5);
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, loose.waybillId));

      const error = await tx
        .transaction((trx) =>
          wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx),
        )
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ response: { code: 'BATCH_JOIN_BLOCKED' } });
      const reasons = (error as { response: { errors: Array<{ reason: string }> } }).response.errors.map(
        (b) => b.reason,
      );
      expect(reasons.sort()).toEqual(['STOCK_SHORT', 'WAYBILL_NOT_READY']);
    });
  });

  it('완료된 배치와 세션이 active 가 아닌 배치에는 BATCH_NOT_JOINABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(
        tx.transaction((trx) =>
          wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });

      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'active', recoveryReason: null })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'completed', completedAt: new Date() }) // ck_outbound_work_items_completion
        .where(inArray(wmsTables.outboundBatchWorkItems.id, [first.workItemId, second.workItemId]));
      await expect(
        tx.transaction((trx) =>
          wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });
    });
  });

  it('같은 멱등 키로 다시 보내면 같은 작업 항목이고 인계가 늘지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      const key = `j-${randomUUID()}`;
      const a = await wiring.batches.addShipment(first.batchId, loose.shipmentId, key, actor, tx);
      const b = await wiring.batches.addShipment(first.batchId, loose.shipmentId, key, actor, tx);
      expect(b.workItem.id).toBe(a.workItem.id);
      expect((await sessionOf(tx, sessionId)).handedInQty).toBe(6);
    });
  });

  it.each(['individual', 'multi_order', 'total_picking'] as const)('%s 배치에도 합류한다', async (method) => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: method, cartCapacity: method === 'multi_order' ? 10 : null })
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      const wiring = assembleOutbound(tx);
      // 테스트 배선의 전략 레지스트리는 discrete 만 안다 — 시작 진입점을 직접 부른다(배정은 방식과 무관하다).
      await startBatchPicking(
        wiring.startDeps,
        STRATEGY_BY_PICKING_METHOD[method],
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const loose = await seedLooseBox(tx, first, 2);

      const joined = await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      expect((await allocationsOf(tx, [joined.workItem.id])).reduce((t, r) => t + r.qty, 0)).toBe(2);
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId, loose.shipmentId]);
    });
  });
});
