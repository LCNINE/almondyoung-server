import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedSpareStock, startedShortPickBox } from './__support__/short-pick-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('결품 보고 — 재배정 (스펙 §9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('다른 로케이션 재고로 채운다 — 박스·작업 항목·송장·예약은 그대로, 오퍼레이션 completed, 송장은 재출력 대상', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, report } = await startedShortPickBox(tx, 1);
      const spare = await seedSpareStock(tx, box, 5);
      const [before] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));

      const result = await report(2);

      expect(result).toMatchObject({
        outcome: 'refilled',
        operationStatus: 'completed',
        refills: [
          { shipmentLineId: box.shipmentLineId, sourceLocationId: spare.locationId, locationCode: spare.code, qty: 2 },
        ],
        shortages: [],
      });
      const [after] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(after).toMatchObject({
        status: before.status,
        leaseVersion: before.leaseVersion,
        waitingOperationId: null,
      });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment).toMatchObject({ status: 'planned', manifestVersion: 1 });
      const [waybill] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, box.shipmentId));
      expect(waybill.status).toBe('registered'); // 송장 스캔의 reprint_required 는 Task 8 이 본다
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  // 10-03 스테이션 실기: 채움 뒤 새 송장을 찍고 마지막 상품을 찍으면 PICKING_INCOMPLETE 였다. 결품 승인이 옛 위치의
  // 배정을 0 으로 남기는데, 완료 판정이 0 짜리 배정에도 «작업자가 그만큼 들고 있나» 를 물었다(잔고 행이 없어 거절).
  it('채운 뒤 나머지를 찍으면 출고까지 끝난다 — 결품으로 0 이 된 옛 배정은 완료 판정에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 하나도 안 집은 줄을 전부 결품한다 — 옛 위치 배정이 0 으로 남는 경우(실기의 B3 와 같은 모양).
      const { box, wiring, report } = await startedShortPickBox(tx, 0);
      await seedSpareStock(tx, box, 5);
      expect(await report(3)).toMatchObject({ outcome: 'refilled' });

      const actor = { id: box.actorId, roles: ['logistics_worker'] };
      const done = await wiring.simple.scan(
        box.shipmentId,
        { barcode: box.barcode, quantity: 3, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );
      expect(done).toMatchObject({ status: 'shipped' });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('배치에 박스 하나 — 안 집은 3개를 전부 결품해도 여분으로 채운다(세션이 비지 않게 인계를 부족 승인보다 먼저)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, report } = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, box, 5);

      const result = await report(3);

      expect(result).toMatchObject({
        outcome: 'refilled',
        operationStatus: 'completed',
        refills: [{ shipmentLineId: box.shipmentLineId, sourceLocationId: spare.locationId, qty: 3 }],
        shortages: [],
      });
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      const qtyAt = (locationId: string) =>
        allocations.filter((row) => row.sourceLocationId === locationId).reduce((total, row) => total + row.qty, 0);
      expect(qtyAt(box.locationId)).toBe(0);
      expect(qtyAt(spare.locationId)).toBe(3);
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session).toMatchObject({ status: 'active', shortageQty: 3 });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('배치에 박스 하나 — 안 집은 3개를 전부 결품하고 여분도 없으면 세션이 닫혀도 그 자리에서 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId, report } = await startedShortPickBox(tx, 0);

      const result = await report(3);

      expect(result).toMatchObject({
        outcome: 'exited',
        operationStatus: 'completed',
        refills: [],
        shortages: [
          expect.objectContaining({ shipmentLineId: box.shipmentLineId, shortQty: 3, reason: 'STOCK_SHORT' }),
        ],
      });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('draft');
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem).toMatchObject({ status: 'excluded', exitTo: 'draft', waitingOperationId: null });
      const waybills = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, box.shipmentId));
      expect(waybills.map((waybill) => waybill.status)).toEqual(['voided']);
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));
      const reservedAs = (status: string) =>
        reservations.filter((row) => row.status === status).reduce((total, row) => total + row.quantity, 0);
      expect(reservedAs('released')).toBe(3);
      expect(reservedAs('confirmed')).toBe(0);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session).toMatchObject({ status: 'settled', shortageQty: 3 });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('집은 몫을 넘는 결품(3개 중 1개 집고 3개 결품)은 SHORT_PICK_EXCEEDS_UNPICKED — 오퍼레이션도 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 1);
      const error = await tx.transaction(() => report(3)).catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'SHORT_PICK_EXCEEDS_UNPICKED' } });
      const operations = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.shipmentId, box.shipmentId));
      expect(operations).toEqual([]);
    });
  });

  it('못 채우고 집은 것도 없으면 그 자리에서 빠진다 — outcome exited, shortages 에 STOCK_SHORT', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, sessionId, wiring, report } = await startedShortPickBox(tx, 0);
      const result = await report(2);
      expect(result).toMatchObject({
        outcome: 'exited',
        operationStatus: 'completed',
        refills: [],
        shortages: [
          expect.objectContaining({ shipmentLineId: box.shipmentLineId, shortQty: 2, reason: 'STOCK_SHORT' }),
        ],
      });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('draft');
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('못 채우고 집은 게 있으면 withdrawing — 오퍼레이션 pending, 박스 planned·송장 유효', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 1);
      const result = await report(2);
      expect(result).toMatchObject({ outcome: 'withdrawing', operationStatus: 'pending' });
      const [workItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(workItem).toMatchObject({
        status: 'withdrawing',
        exitTo: 'draft',
        waitingOperationId: result.operationId,
        exclusionReason: 'short_pick:inventory_shortage',
      });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('같은 멱등 키는 같은 응답을 돌려준다(재배정을 두 번 하지 않는다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      await seedSpareStock(tx, box, 5);
      const key = `sp-${randomUUID()}`;
      const first = await report(2, key);
      const second = await report(2, key);
      expect(second).toEqual(first);
      const rows = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(rows.reduce((total, row) => total + row.qty, 0)).toBe(3);
    });
  });

  it('빼는 중인 박스는 SHIPMENT_WITHDRAWN, 세션이 recovery_required 면 PICKING_SESSION_NOT_ACTIVE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, report } = await startedShortPickBox(tx, 1);
      await wiring.batches.excludeShipment(
        box.batchId,
        box.shipmentId,
        { reason: '급한 변경' },
        `x-${randomUUID()}`,
        actor,
        tx,
      );
      await expect(tx.transaction(() => report(1))).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
    await inRollbackTx(db, async (tx) => {
      const { sessionId, report } = await startedShortPickBox(tx, 0);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test drift' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(tx.transaction(() => report(1))).rejects.toMatchObject({
        response: { code: 'PICKING_SESSION_NOT_ACTIVE' },
      });
    });
  });
});
