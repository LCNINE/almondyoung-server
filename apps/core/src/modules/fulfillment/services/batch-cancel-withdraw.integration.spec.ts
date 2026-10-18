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

async function workItemOf(tx: DbTx, workItemId: string) {
  const [item] = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
  return item;
}

async function shipmentOf(tx: DbTx, shipmentId: string) {
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
  return shipment;
}

async function waybillOf(tx: DbTx, waybillId: string) {
  const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, waybillId));
  return waybill;
}

async function confirmedReservationQty(tx: DbTx, shipmentLineId: string) {
  const rows = await tx
    .select()
    .from(wmsTables.stockReservations)
    .where(eq(wmsTables.stockReservations.shipmentLineId, shipmentLineId));
  return rows.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + row.quantity, 0);
}

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

  // 스펙 §4.2: 대기 상자가 배치를 떠나면 재개가 §4.1 과 같은 손질을 한다 — E10 이 이탈 때 송장을 무효화하는 것과 같다.
  it('부분 취소 대기(E11) 뒤 운영자가 박스를 draft 로 빼면 재개가 registered 송장을 로컬 무효화하고 취소를 끝낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await started(tx);
      const pending = await cancel(wiring, first, tx, 1); // 첫 박스는 수량 2
      expect(pending.operationStatus).toBe('pending');

      const excluded = await wiring.batches.excludeShipment(
        first.batchId,
        first.shipmentId,
        { reason: '취소 대기 상자 빼기' },
        `x-${randomUUID()}`,
        actor,
        tx,
      );

      expect(excluded.workItem).toMatchObject({ status: 'excluded', exitTo: 'draft' });
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({
        status: 'draft',
        plannedAt: null,
        recoveryCode: null,
      });
      expect((await waybillOf(tx, first.waybillId)).status).toBe('voided');
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
      expect(line).toMatchObject({ qty: 1, reservedQty: 1 });
      expect(await confirmedReservationQty(tx, first.shipmentLineId)).toBe(1);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, pending.operationId));
      expect(operation.status).toBe('completed');
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId]);
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

  it('빼는 중(draft)인 박스는 송장이 registered 가 아니어도 canceled 로 올린다 — 나가기는 송장이 정리된 뒤 마지막 되돌림에서', async () => {
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
      expect(item).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: result.operationId });
      const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, second.waybillId));
      expect(waybill.status).toBe('pending');
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

// #1016 30번 — 시작 전 배치의 상자는 빠질 배치가 «시작되기 전»이라 이탈(E10)이 아니라 그 자리에서 끝낸다(스펙 §4.1).
describeIfDb('시작 전 배치의 상자 취소 → 배치에서 빼고 그 자리에서 끝낸다 (#1016 30번)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('전량 취소하면 작업 항목 excluded·송장 voided·상자 canceled — 같은 배치의 다른 상자로 배치가 시작된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);

      const result = await cancel(wiring, first, tx);

      expect(result.operationStatus).toBe('completed');
      expect(await workItemOf(tx, first.workItemId)).toMatchObject({
        status: 'excluded',
        exclusionReason: '고객 취소',
      });
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({ status: 'canceled', recoveryCode: null });
      expect((await waybillOf(tx, first.waybillId)).status).toBe('voided');
      expect(await confirmedReservationQty(tx, first.shipmentLineId)).toBe(0);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');

      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      expect(run.sessionId).toBeTruthy();
      const allocated = await tx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.pickingSourceAllocations)
        .innerJoin(
          wmsTables.outboundBatchWorkItems,
          eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
        )
        .where(eq(wmsTables.outboundBatchWorkItems.batchId, first.batchId));
      expect(new Set(allocated.map((row) => row.shipmentId))).toEqual(new Set([second.shipmentId]));
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('일부 취소하면 배치에서 빠지고 draft 로 돌아간다 — 남은 몫은 다시 계획해야 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);

      const result = await cancel(wiring, first, tx, 1); // 첫 박스는 수량 2

      expect(result.operationStatus).toBe('completed');
      expect(await workItemOf(tx, first.workItemId)).toMatchObject({
        status: 'excluded',
        exclusionReason: '고객 취소',
      });
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({
        status: 'draft',
        plannedAt: null,
        recoveryCode: null,
      });
      expect((await waybillOf(tx, first.waybillId)).status).toBe('voided');
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, first.shipmentLineId));
      expect(line).toMatchObject({ qty: 1, reservedQty: 1 });
      expect(await confirmedReservationQty(tx, first.shipmentLineId)).toBe(1);
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId]);
    });
  });
});
