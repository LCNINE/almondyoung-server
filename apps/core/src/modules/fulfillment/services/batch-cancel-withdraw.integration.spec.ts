import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { PickableShipmentFixture } from './__support__/logistics-fixtures';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('전체 취소 → 이탈 (스펙 §8 E10, PR 3)', () => {
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

  async function cancel(
    wiring: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    tx: DbTx,
    qty?: number,
  ) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return wiring.planning.cancelOutstanding(
      box.shipmentId,
      {
        expectedManifestVersion: shipment.manifestVersion,
        reason: '고객 취소',
        lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: qty ?? line.qty }],
      },
      `c-${randomUUID()}`,
      actor,
      tx,
    );
  }

  const pickAll = (
    wiring: ReturnType<typeof assembleOutbound>,
    sessionId: string,
    box: PickableShipmentFixture,
    tx: DbTx,
  ) =>
    wiring.sessions.moveCustody(
      {
        sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: box.actorId,
        quantity: box.qty,
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

  it('집은 게 없으면 그 트랜잭션에서 끝난다 — 반납·나가기·송장 무효·예약 해제·박스 canceled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('completed');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'excluded', exitTo: 'canceled', waitingOperationId: result.operationId });
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment).toMatchObject({ status: 'canceled', recoveryCode: null });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('voided');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.filter((reservation) => reservation.status === 'confirmed')).toEqual([]);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('집은 게 있으면 pending — 박스는 planned 로 withdrawing(exit_to canceled)이 되고 취소 오퍼레이션을 기다린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId } = await started(tx);
      await pickAll(wiring, sessionId, second, tx);
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: result.operationId });
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment).toMatchObject({ status: 'planned', recoveryCode: null });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('registered');
    });
  });

  it('운영자가 빼는 중(draft)인 박스에 전체 취소가 오면 canceled 로 올린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await pickAll(wiring, sessionId, second, tx);
      await wiring.batches.excludeShipment(
        first.batchId,
        second.shipmentId,
        { reason: '급한 변경' },
        `x-${randomUUID()}`,
        actor,
        tx,
      );
      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: result.operationId });
    });
  });

  it('부분 취소는 지금처럼 대기(CANCEL_REPLAN_PENDING) — E11', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await started(tx);
      const result = await cancel(wiring, first, tx, 1); // 첫 박스는 수량 2
      expect(result.operationStatus).toBe('pending');
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, first.shipmentId));
      expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, first.workItemId));
      expect(item.status).toBe('queued');
    });
  });

  it('활성 송장이 registered 가 아니면(pending) 이탈하지 않고 지금처럼 대기한다 — 취소가 NOT_VOIDABLE 로 되돌려지지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await started(tx);
      // 재발급·일시적 거절(#914) 뒤처럼 활성 송장이 아직 등록되지 않은 박스. 집은 게 없어 이탈이면 이 트랜잭션에서 나가려 한다.
      await tx
        .update(wmsTables.waybills)
        .set({ source: 'carrier', status: 'pending' })
        .where(eq(wmsTables.waybills.id, second.waybillId));

      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item.status).not.toBe('withdrawing');
      expect(item).toMatchObject({ status: 'queued', exitTo: null, waitingOperationId: result.operationId });
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('pending');
    });
  });

  it('빼는 중(draft)인 박스도 송장이 registered 가 아니면 canceled 로 올리지 않고 지금처럼 대기한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await pickAll(wiring, sessionId, second, tx);
      await wiring.batches.excludeShipment(
        first.batchId,
        second.shipmentId,
        { reason: '급한 변경' },
        `x-${randomUUID()}`,
        actor,
        tx,
      );
      await tx
        .update(wmsTables.waybills)
        .set({ source: 'carrier', status: 'pending' })
        .where(eq(wmsTables.waybills.id, second.waybillId));

      const result = await cancel(wiring, second, tx);

      expect(result.operationStatus).toBe('pending');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'draft', waitingOperationId: result.operationId });
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment.recoveryCode).toBe('CANCEL_REPLAN_PENDING');
    });
  });

  it('세션이 active 가 아니면 이탈하지 않고 지금처럼 대기한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId } = await started(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test drift' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const result = await cancel(wiring, second, tx);
      expect(result.operationStatus).toBe('pending');
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment.recoveryCode).toBe('CANCEL_REPLAN_PENDING');
    });
  });
});
