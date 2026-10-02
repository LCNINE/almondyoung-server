import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from '../picking/allocation/batch-start';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';
import { loadWithdrawalRemovals } from './withdrawal-removals.query';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('시작된 배치에서 이탈 (스펙 §8, PR 2·3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function started(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    return { first, second, wiring, sessionId: run.sessionId };
  }
  const exclude = (
    wiring: ReturnType<typeof assembleOutbound>,
    batchId: string,
    shipmentId: string,
    tx: DbTx,
    key = `x-${randomUUID()}`,
  ) => wiring.batches.excludeShipment(batchId, shipmentId, { reason: '급한 변경' }, key, actor, tx);
  const general = (tx: DbTx, f: { skuId: string; warehouseId: string; locationId: string }) =>
    new BatchControlledStockGuard().getAvailability(
      { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.locationId },
      tx,
    );

  it('집지 않은 박스는 반납하고 excluded — 배정 행은 0 으로 남고 박스는 planned·예약 그대로, 재고는 일반 가용으로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const firstBefore = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      const availableBefore = (await general(tx, second)).generallyAvailableQty;

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem.status).toBe('excluded');
      expect(result.workItem.exitTo).toBe('draft');
      const rows = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
      expect(rows.map((row) => row.qty)).toEqual([0]);
      const handBacks = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_BACK'),
          ),
        );
      expect(
        handBacks.map((event) => [event.quantity, (event.payload as Record<string, unknown>).allocationId]),
      ).toEqual([[1, rows[0].id]]);
      expect((await general(tx, second)).generallyAvailableQty).toBe(availableBefore + 1);
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment.status).toBe('planned');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.map((r) => r.status)).toEqual(['confirmed']);
      expect(
        await tx
          .select()
          .from(wmsTables.pickingSourceAllocations)
          .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId)),
      ).toEqual(firstBefore);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('집은 몫이 있으면 withdrawing — 집지 않은 몫만 반납하고, 사유·exit_to 를 적고, 뺄 목록이 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      // 둘째 박스(수량 1)를 집는다 — 반납할 몫이 없다.
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem).toMatchObject({ status: 'withdrawing', exitTo: 'draft', exclusionReason: '급한 변경' });
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.handedBackQty).toBe(0);
      expect(await loadWithdrawalRemovals(tx, second.workItemId)).toEqual([
        expect.objectContaining({ shipmentLineId: second.shipmentLineId, boxQty: 1, cartQty: 0 }),
      ]);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('일부만 집었으면 나머지는 그 자리에서 반납된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId } = await started(tx);
      // 첫 박스(수량 2) 중 1 을 집는다.
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 1,
          from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'WORKER',
            custodyRef: first.actorId,
            shipmentLineId: first.shipmentLineId,
          },
        },
        tx,
      );
      const availableBefore = (await general(tx, first)).generallyAvailableQty;

      const result = await exclude(wiring, first.batchId, first.shipmentId, tx);

      expect(result.workItem.status).toBe('withdrawing');
      const [allocation] = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      expect(allocation.qty).toBe(1);
      expect((await general(tx, first)).generallyAvailableQty).toBe(availableBefore + 1);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('빼는 중인 박스를 다시 빼면 SHIPMENT_ALREADY_WITHDRAWING', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );
      await exclude(wiring, first.batchId, second.shipmentId, tx);
      await expect(
        tx.transaction((trx) => exclude(wiring, first.batchId, second.shipmentId, trx)),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_ALREADY_WITHDRAWING' } });
      const listed = await wiring.batches.listBatches({ warehouseId: first.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === first.batchId)).toMatchObject({
        status: 'picking',
        withdrawingItems: 1,
      });
      const candidates = await wiring.batches.findJoinCandidates(first.batchId, second.trackingNo, tx);
      expect(candidates.map((candidate) => candidate.issue)).toEqual(['SHIPMENT_WITHDRAWING']);
    });
  });

  it('토트가 배정돼 있어도 뺄 수 있다 — 비어 있으면 나가면서 토트를 푼다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring } = await started(tx);
      const [tote] = await tx
        .insert(wmsTables.totes)
        .values({ warehouseId: second.warehouseId, barcode: `T-${randomUUID().slice(0, 8)}`, status: 'in_use' })
        .returning();
      await tx
        .insert(wmsTables.shipmentToteAssignments)
        .values({ shipmentId: second.shipmentId, toteId: tote.id, assignedBy: second.actorId });

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem.status).toBe('excluded');
      const [assignment] = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.toteId, tote.id));
      expect(assignment.releasedAt).not.toBeNull();
      const [released] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, tote.id));
      expect(released.status).toBe('available');
    });
  });

  it('토탈피킹: AT_SOURCE 가 그 박스 몫을 덮으면 반납, 카트에 실린 몫은 배정에 남아 withdrawing', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'total_picking' })
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      const wiring = assembleOutbound(tx);
      const run = await startBatchPicking(
        wiring.startDeps,
        'aggregate_then_sort',
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      // AT_SOURCE 3(첫 박스 2 + 둘째 1) 중 2 를 카트로 — 누구 몫인지 모른다. 남은 AT_SOURCE 1 이 둘째 박스 몫을 덮는다.
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 2,
          from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: first.skuId,
            sourceLocationId: first.locationId,
            custodyType: 'BULK_CART',
            custodyRef: 'CART-1',
          },
        },
        tx,
      );
      const withdrawn = await exclude(wiring, first.batchId, second.shipmentId, tx);
      expect(withdrawn.workItem.status).toBe('excluded');
      const [afterFirst] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, run.sessionId));
      expect(afterFirst.handedBackQty).toBe(1);

      // 이제 AT_SOURCE 는 0 — 첫 박스 몫 2 는 카트에 실렸다. 배정은 그대로 두고 withdrawing(정한 것 2).
      const firstOut = await exclude(wiring, first.batchId, first.shipmentId, tx);
      expect(firstOut.workItem.status).toBe('withdrawing');
      expect(await loadWithdrawalRemovals(tx, first.workItemId)).toEqual([
        expect.objectContaining({ boxQty: 0, cartQty: 2 }),
      ]);
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('빠진 박스는 같은 배치에 다시 합류할 수 있다 — 옛 0 행과 새 배정이 공존해도 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await exclude(wiring, first.batchId, second.shipmentId, tx);

      const rejoined = await wiring.batches.addShipment(
        first.batchId,
        second.shipmentId,
        `j-${randomUUID()}`,
        actor,
        tx,
      );

      expect(rejoined.workItem.id).not.toBe(second.workItemId);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('같은 배치에 다시 합류한 박스를 집어도 healthy — 줄 보관은 그 줄·로케이션의 배정 합과 견준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await exclude(wiring, first.batchId, second.shipmentId, tx);
      await wiring.batches.addShipment(first.batchId, second.shipmentId, `j-${randomUUID()}`, actor, tx);

      // 옛 0 행과 새 배정 행이 같은 줄·로케이션을 가리킨다 — 집은 1 은 둘의 합(0 + 1)과 견줘야 한다.
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );

      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('박스를 모두 빼면 세션은 settled, 배치는 canceled 로 보이고 다시 넣을 수 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await exclude(wiring, first.batchId, first.shipmentId, tx);
      await exclude(wiring, first.batchId, second.shipmentId, tx);

      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.status).toBe('settled');
      const listed = await wiring.batches.listBatches({ warehouseId: first.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === first.batchId)?.status).toBe('canceled');
      await expect(
        tx.transaction((trx) =>
          wiring.batches.addShipment(first.batchId, second.shipmentId, `j-${randomUUID()}`, actor, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });
    });
  });

  it('같은 멱등 키로 다시 보내면 반납이 한 번이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const key = `x-${randomUUID()}`;
      await exclude(wiring, first.batchId, second.shipmentId, tx, key);
      await exclude(wiring, first.batchId, second.shipmentId, tx, key);
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.handedBackQty).toBe(1);
    });
  });
});
