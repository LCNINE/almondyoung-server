// apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-cancellation.rule.integration.spec.ts
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../services/__support__';
import { PickableShipmentFixture, seedPickableShipment } from '../../services/__support__/logistics-fixtures';
import { seedTwoBoxBatch } from '../../services/__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from '../../services/__support__/simple-outbound-wiring';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { seedSettling } from '../../order-progress/__support__/order-progress.fixtures';
import { OrderProgressManager } from '../../order-progress/order-progress.manager';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { OrderReconcileRepository } from '../order-reconcile.repository';
import { OrderReconcileRunner } from '../order-reconcile.runner';
import { ShipmentReconcileRepository } from '../shipment-reconcile.repository';
import { ResumePendingCancellationRule } from './resume-pending-cancellation.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

const gate = (mode: 'v2' | 'maintenance') =>
  new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
  );

describeIfDb('ResumePendingCancellationRule (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(tx: DbTx, mode: 'v2' | 'maintenance' = 'v2') {
    const dbs = ambientDbService(tx);
    const outbound = assembleOutbound(tx);
    const rule = new ResumePendingCancellationRule(outbound.planning, gate(mode));
    const reader = new OrderProgressReader(dbs);
    const runner = new OrderReconcileRunner(
      dbs,
      new OrderReconcileRepository(dbs),
      new ShipmentReconcileRepository(dbs),
      reader,
      [rule],
    );
    const project = (salesOrderId: string, now: Date) =>
      new OrderProgressManager(dbs).refreshScope(sql`SELECT ${salesOrderId}::uuid`, now, tx);
    return { outbound, rule, reader, runner, project };
  }

  async function cancel(
    outbound: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    tx: DbTx,
    qty?: number,
  ) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return outbound.planning.cancelOutstanding(
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

  /** 시작 전 배치의 planned 상자인데 송장이 아직 발급 중(pending)이라 취소가 대기(CANCEL_REPLAN_PENDING)로 간 상태 */
  async function waitingForIssuingWaybill(tx: DbTx, outbound: ReturnType<typeof assembleOutbound>) {
    const box = await seedPickableShipment(tx, 2);
    // manual 송장은 pending 일 수 없다(ck_waybills_manual_status) — 발급 중은 carrier 송장이다
    await tx
      .update(wmsTables.waybills)
      .set({ source: 'carrier', status: 'pending' })
      .where(eq(wmsTables.waybills.id, box.waybillId));
    const pending = await cancel(outbound, box, tx);
    expect(pending.operationStatus).toBe('pending');
    const registerWaybill = () =>
      tx.update(wmsTables.waybills).set({ status: 'registered' }).where(eq(wmsTables.waybills.id, box.waybillId));
    return { box, operationId: pending.operationId, registerWaybill };
  }

  it('송장이 발급 중이면 check false·지문에 WAYBILL_NOT_VOIDABLE, 송장이 registered 가 되면 지문이 바뀌고 check true', async () => {
    await inRollbackTx(db, async (tx) => {
      const { outbound, rule } = wire(tx);
      const w = await waitingForIssuingWaybill(tx, outbound);

      const before = await rule.fingerprint(w.box.shipmentId, tx);
      expect(before).toContain(w.operationId);
      expect(before).toContain('WAYBILL_NOT_VOIDABLE');
      expect(await rule.check(w.box.shipmentId, tx)).toBe(false);

      await w.registerWaybill();

      expect(await rule.fingerprint(w.box.shipmentId, tx)).not.toBe(before);
      expect(await rule.check(w.box.shipmentId, tx)).toBe(true);
    });
  });

  it('act: 막힘이 남았으면 noop·그대로, 풀린 뒤 재개하면 acted(송장 voided·상자 canceled·작업 항목 excluded), 다시 부르면 noop', async () => {
    await inRollbackTx(db, async (tx) => {
      const { outbound, rule } = wire(tx);
      const w = await waitingForIssuingWaybill(tx, outbound);

      expect(await rule.act(w.box.shipmentId, tx)).toBe('noop');
      expect(await shipmentOf(tx, w.box.shipmentId)).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
      });
      expect((await waybillOf(tx, w.box.waybillId)).status).toBe('pending');

      await w.registerWaybill();
      expect(await rule.act(w.box.shipmentId, tx)).toBe('acted');

      expect(await shipmentOf(tx, w.box.shipmentId)).toMatchObject({ status: 'canceled', recoveryCode: null });
      expect((await waybillOf(tx, w.box.waybillId)).status).toBe('voided');
      expect(await workItemOf(tx, w.box.workItemId)).toMatchObject({ status: 'excluded' });
      expect(await operationStatus(tx, w.operationId)).toBe('completed');

      expect(await rule.act(w.box.shipmentId, tx)).toBe('noop');
      expect(await rule.check(w.box.shipmentId, tx)).toBe(false);
    });
  });

  it('정비 모드면 막힘이 풀렸어도 check false — 일시적 막힘은 시도로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { outbound } = wire(tx);
      const w = await waitingForIssuingWaybill(tx, outbound);
      await w.registerWaybill();
      const { rule } = wire(tx, 'maintenance');
      expect(await rule.check(w.box.shipmentId, tx)).toBe(false);
    });
  });

  it('시작된 배치의 상자 일부 취소는 check false·지문에 STARTED_BATCH — 배치에서 빠질 때 기존 신호로 재개된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { outbound, rule } = wire(tx);
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      await outbound.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const pending = await cancel(outbound, first, tx, 1); // 첫 상자는 수량 2
      expect(pending.operationStatus).toBe('pending');
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({ recoveryCode: 'CANCEL_REPLAN_PENDING' });

      expect(await rule.fingerprint(first.shipmentId, tx)).toBe(`${pending.operationId}|STARTED_BATCH`);
      expect(await rule.check(first.shipmentId, tx)).toBe(false);
      expect(await rule.act(first.shipmentId, tx)).toBe('noop');
      expect(await shipmentOf(tx, first.shipmentId)).toMatchObject({ status: 'recovery_required' });
    });
  });

  // 스펙 §4.2 — 틀의 제외 목록을 넓히지 않는다. 취소된 주문·셀프취소로 채널 취소 정산 중인 주문이 이 규칙의 주 대상이다.
  it.each([
    { order: '판매주문이 살아 있음', cancelled: false, settling: false, orderRules: ['unit'] },
    { order: '판매주문 cancelled', cancelled: true, settling: false, orderRules: ['cancel_open'] },
    {
      order: '셀프취소 — 판매주문 cancelled + 정산 중 취소 요청',
      cancelled: true,
      settling: true,
      orderRules: ['cancel_open'],
    },
    {
      order: '정산 중 취소 요청(판매주문은 살아 있음)',
      cancelled: false,
      settling: true,
      orderRules: ['cancel_settle'],
    },
  ])(
    '투영 → 러너 → 규칙 끝까지($order): 실행 모드라 막힘이 풀린 대기 취소를 끝내고 상태 행은 acted',
    async ({ cancelled, settling, orderRules }) => {
      await inRollbackTx(db, async (tx) => {
        const { outbound, rule, reader, runner, project } = wire(tx);
        expect(rule.mode).toBe('act');
        const w = await waitingForIssuingWaybill(tx, outbound);
        const salesOrderId = await salesOrderIdOf(tx, w.box.shipmentLineId);
        if (cancelled) {
          await tx
            .update(wmsTables.salesOrders)
            .set({ status: 'cancelled' })
            .where(eq(wmsTables.salesOrders.id, salesOrderId));
        }
        if (settling) await seedSettling(tx, salesOrderId, { createdAt: new Date() });
        await w.registerWaybill();
        const now = new Date('2099-06-01T00:00:00.000Z');
        await project(salesOrderId, now);

        expect(await reader.judgeShipment(w.box.shipmentId, tx)).toMatchObject({
          stage: 'cancel',
          state: 'CANCEL_REPLAN_PENDING',
          orderRules,
        });
        const summary = await runner.runRule(rule, now, tx);

        expect(summary).toMatchObject({ acted: 1, errors: 0 });
        expect(await stateOf(tx, rule.name, w.box.shipmentId)).toMatchObject({
          lastResult: 'acted',
          mode: 'act',
          trackingRow: 30,
        });
        expect(await shipmentOf(tx, w.box.shipmentId)).toMatchObject({ status: 'canceled', recoveryCode: null });
        expect((await waybillOf(tx, w.box.waybillId)).status).toBe('voided');
      });
    },
  );

  it('셀메이트로 출고된(판매주문 shipped) 주문의 상자는 실행 모드여도 건드리지 않는다 — 틀의 D16 제외', async () => {
    await inRollbackTx(db, async (tx) => {
      const { outbound, rule, runner, project } = wire(tx);
      const w = await waitingForIssuingWaybill(tx, outbound);
      const salesOrderId = await salesOrderIdOf(tx, w.box.shipmentLineId);
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
      await w.registerWaybill();
      const now = new Date('2099-06-01T00:00:00.000Z');
      await project(salesOrderId, now);

      await runner.runRule(rule, now, tx);

      expect(await stateOf(tx, rule.name, w.box.shipmentId)).toBeUndefined();
      expect(await shipmentOf(tx, w.box.shipmentId)).toMatchObject({ recoveryCode: 'CANCEL_REPLAN_PENDING' });
      expect((await waybillOf(tx, w.box.waybillId)).status).toBe('registered');
    });
  });
});

async function salesOrderIdOf(tx: DbTx, shipmentLineId: string) {
  const [row] = await tx
    .select({ salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.shipmentLines.id, shipmentLineId));
  if (!row?.salesOrderId) throw new Error(`shipment line ${shipmentLineId} has no sales order`);
  return row.salesOrderId;
}

async function stateOf(tx: DbTx, rule: string, shipmentId: string) {
  const s = wmsTables.shipmentReconcileState;
  const [row] = await tx
    .select()
    .from(s)
    .where(and(eq(s.rule, rule), eq(s.shipmentId, shipmentId)));
  return row;
}

async function shipmentOf(tx: DbTx, shipmentId: string) {
  const [row] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
  return row;
}

async function waybillOf(tx: DbTx, waybillId: string) {
  const [row] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, waybillId));
  return row;
}

async function workItemOf(tx: DbTx, workItemId: string) {
  const [row] = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
  return row;
}

async function operationStatus(tx: DbTx, operationId: string) {
  const [row] = await tx
    .select({ status: wmsTables.shipmentOperations.status })
    .from(wmsTables.shipmentOperations)
    .where(eq(wmsTables.shipmentOperations.id, operationId));
  return row?.status;
}
