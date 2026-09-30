import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedShortPickOperation } from './__support__/short-pick-fixtures';
import { seedPickableShipment } from './__support__/logistics-fixtures';
import { seedReturnBin } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('결품 이탈의 마무리 (스펙 §9-5, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스(A 3개)를 시작하고 picked 개를 집은 뒤, 2개 결품(못 채움) 상태로 이탈을 시작한다. */
  async function withdrawingForShortPick(tx: DbTx, picked: number) {
    const box = await seedPickableShipment(tx, 3);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
    if (picked) {
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId: box.actorId,
          quantity: picked,
          from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
          to: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'WORKER', custodyRef: box.actorId, shipmentLineId: box.shipmentLineId },
        },
        tx,
      );
    }
    const session = await wiring.boxes.lockOpenSession(box.batchId, tx);
    if (!session) throw new Error('session missing');
    const operation = await seedShortPickOperation(tx, {
      shipmentId: box.shipmentId,
      workItemId: box.workItemId,
      sessionId: session.id,
      actorId: box.actorId,
      lines: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, shortQty: 2, allocationQty: 3 }],
    });
    const planned = await wiring.boxes.planShortages(
      { session, workItemId: box.workItemId,
        shortages: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: box.locationId, qty: 2 }] },
      tx,
    );
    await wiring.boxes.approveShortages(
      { session, workItemId: box.workItemId, shortPickOperationId: operation.id, actorId: box.actorId,
        reasonCode: 'MISSING', reason: operation.reason, planned },
      tx,
    );
    const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId)).for('update');
    const outcome = await wiring.withdrawals.begin(
      {
        batchId: box.batchId,
        shipmentId: box.shipmentId,
        shipmentStatus: 'planned',
        workItem,
        lines: [{ id: box.shipmentLineId, skuId: box.skuId }],
        exitTo: 'draft',
        reason: `short_pick:${operation.reason}`,
        waitingOperationId: operation.id,
        actorId: box.actorId,
        operationId: randomUUID(),
      },
      tx,
    );
    return { box, wiring, sessionId: run.sessionId, operation, outcome };
  }

  async function stateOf(tx: DbTx, box: { shipmentId: string; shipmentLineId: string; workItemId: string }, operationId: string) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
    const waybills = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, box.shipmentId));
    const reservations = await tx.select().from(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));
    const [operation] = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, operationId));
    return { shipment, workItem, waybills, reservations, operation };
  }

  it('집은 게 없으면 그 트랜잭션에서 나가며 결품을 마무리한다 — 예약 −2, 송장 무효, 박스 draft, 오퍼레이션 completed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, operation, outcome } = await withdrawingForShortPick(tx, 0);
      expect(outcome.kind).toBe('exited');
      const state = await stateOf(tx, box, operation.id);
      expect(state.workItem).toMatchObject({ status: 'excluded', exitTo: 'draft', waitingOperationId: null });
      expect(state.shipment).toMatchObject({ status: 'draft', manifestVersion: 2, plannedAt: null, recoveryCode: null });
      expect(state.waybills.map((w) => w.status)).toEqual(['voided']);
      expect(state.reservations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'confirmed', quantity: 1 }),
          expect.objectContaining({ status: 'released', quantity: 2 }),
        ]),
      );
      expect(state.operation).toMatchObject({ status: 'completed' });
      expect(state.operation.afterManifestSnapshot).toMatchObject({ voidedWaybillId: box.waybillId });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('집은 게 있으면 withdrawing 동안 박스·송장·예약이 그대로이고, 마지막 되돌림에서 마무리한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, operation, outcome } = await withdrawingForShortPick(tx, 1);
      expect(outcome.kind).toBe('withdrawing');
      const during = await stateOf(tx, box, operation.id);
      expect(during.shipment).toMatchObject({ status: 'planned', manifestVersion: 1 });
      expect(during.waybills.map((w) => w.status)).toEqual(['registered']);
      expect(during.reservations).toEqual([expect.objectContaining({ status: 'confirmed', quantity: 3 })]);
      expect(during.operation.status).toBe('pending');
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);

      const bin = await seedReturnBin(tx, box.warehouseId, box.actorId);
      const removed = await wiring.returns.removeToReturnBin(
        box.shipmentId,
        { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        { id: box.actorId, roles: ['master'] },
        `rb-${randomUUID()}`,
        tx,
      );
      expect(removed).toMatchObject({ exited: true, exitTo: 'draft', waitingOperationId: null });
      const after = await stateOf(tx, box, operation.id);
      expect(after.shipment).toMatchObject({ status: 'draft', manifestVersion: 2 });
      expect(after.waybills.map((w) => w.status)).toEqual(['voided']);
      expect(after.operation.status).toBe('completed');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('전체 취소가 결품으로 빼는 중인 박스를 넘겨받는다 — 결품 오퍼레이션은 닫히고 취소가 마지막 되돌림에서 완료된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, operation } = await withdrawingForShortPick(tx, 1);
      const [line] = await tx.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
      const canceled = await wiring.planning.cancelOutstanding(
        box.shipmentId,
        { expectedManifestVersion: 1, lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: 3 }], reason: '고객 취소' },
        `c-${randomUUID()}`,
        { id: box.actorId, roles: ['master'] },
        tx,
      );
      expect(canceled.operationStatus).toBe('pending');
      const [shortPick] = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, operation.id));
      expect(shortPick.status).toBe('completed');
      expect(shortPick.afterManifestSnapshot).toMatchObject({ supersededByOperationId: canceled.operationId });
      const [workItem] = await tx.select().from(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem).toMatchObject({ status: 'withdrawing', exitTo: 'canceled', waitingOperationId: canceled.operationId });

      const bin = await seedReturnBin(tx, box.warehouseId, box.actorId);
      await wiring.returns.removeToReturnBin(
        box.shipmentId,
        { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        { id: box.actorId, roles: ['master'] },
        `rb-${randomUUID()}`,
        tx,
      );
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('canceled');
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(and(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId), eq(wmsTables.stockReservations.status, 'confirmed')));
      expect(confirmed).toEqual([]);
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });
});
