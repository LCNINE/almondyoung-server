// apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.integration.spec.ts
import { ConfigService } from '@nestjs/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeConsolidationService,
  makeDb,
  makeDbService,
  pendingConsolidationBlockedByWaybill,
  wireLogistics,
} from '../../services/__support__';
import { OrderProgressManager } from '../../order-progress/order-progress.manager';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRepository } from '../order-reconcile.repository';
import { RunnableReconcileRule } from '../order-reconcile.rule';
import { OrderReconcileRunner } from '../order-reconcile.runner';
import { ShipmentReconcileRepository } from '../shipment-reconcile.repository';
import { ResumePendingConsolidationRule } from './resume-pending-consolidation.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const gate = (mode: 'v2' | 'maintenance') =>
  new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
  );

/** 관찰 모드 규칙을 실행 모드로 감싼다 — 실행 전환 PR 뒤의 동작을 미리 본다 */
const acting = (rule: ResumePendingConsolidationRule): RunnableReconcileRule => ({
  name: rule.name,
  row: rule.row,
  mode: 'act',
  subject: rule.subject,
  situation: rule.situation,
  fingerprint: (id, tx) => rule.fingerprint(id, tx),
  check: (id, tx) => rule.check(id, tx),
  act: (id, tx) => rule.act(id, tx),
});

describeIfDb('ResumePendingConsolidationRule (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(mode: 'v2' | 'maintenance' = 'v2') {
    const dbs = makeDbService(db);
    const w = wireLogistics(dbs, 'v2');
    const consolidation = makeConsolidationService(dbs, w);
    const reader = new OrderProgressReader(dbs);
    const rule = new ResumePendingConsolidationRule(consolidation, gate(mode), reader);
    const runner = new OrderReconcileRunner(
      dbs,
      new OrderReconcileRepository(dbs),
      new ShipmentReconcileRepository(dbs),
      reader,
      [rule],
    );
    return { dbs, w, consolidation, rule, runner };
  }

  async function project(tx: DbTx, dbs: ReturnType<typeof makeDbService>, salesOrderIds: string[], now: Date) {
    await new OrderProgressManager(dbs).refreshScope(
      sql`SELECT unnest(ARRAY[${sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])`,
      now,
      tx,
    );
  }

  async function targets(tx: DbTx, base: { warehouseId: string }) {
    return (
      await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.warehouseId, base.warehouseId))
    ).filter((s) => s.status === 'draft');
  }

  it('송장이 살아 있으면 check false·지문에 ACTIVE_INVOICE, 송장을 취소하면 지문이 바뀌고 check true', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation, rule } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      const before = await rule.fingerprint(p.first.shipment.id, tx);
      expect(before).toContain('ACTIVE_INVOICE');
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);

      await p.voidWaybill();

      expect(await rule.fingerprint(p.first.shipment.id, tx)).not.toBe(before);
      expect(await rule.check(p.first.shipment.id, tx)).toBe(true);
    });
  });

  it('act: 재개해 끝내면 acted(원본 대체·대상 상자 1개), 같은 작업의 다른 원본으로 다시 부르면 noop', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation, rule } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();

      expect(await rule.act(p.first.shipment.id, tx)).toBe('acted');
      expect(await rule.act(p.second.shipment.id, tx)).toBe('noop');

      const sources = await tx
        .select({ status: wmsTables.shipments.status })
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, [p.first.shipment.id, p.second.shipment.id]));
      expect(sources.map((s) => s.status)).toEqual(['superseded', 'superseded']);
      expect(await targets(tx, p.base)).toHaveLength(1);
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
    });
  });

  it('정비 모드면 check false — 일시적 막힘은 시도로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      const { rule } = wire('maintenance');
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
    });
  });

  it('투영 → 러너 → 규칙 끝까지: 관찰 모드는 두 원본에 would_act 만 남기고, 실행 모드는 한 번만 합포장한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, consolidation, rule, runner } = wire();
      expect(rule.mode).toBe('observe');
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      const now = new Date('2099-06-01T00:00:00.000Z');
      await project(tx, dbs, [p.first.salesOrderId, p.second.salesOrderId], now);
      const ours = async () =>
        (await tx.select().from(wmsTables.shipmentReconcileState))
          .filter((r) => r.shipmentId === p.first.shipment.id || r.shipmentId === p.second.shipment.id)
          .map((r) => r.lastResult)
          .sort();

      await runner.runRule(rule, now, tx);
      expect(await ours()).toEqual(['would_act', 'would_act']);
      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBe(p.operationId);

      // 10분 뒤 다시 볼 때가 된다. 먼저 온 원본이 재개해 끝내고, 다른 원본은 대체돼 게이트에서 걸러진다
      await runner.runRule(acting(rule), new Date('2099-06-01T00:11:00.000Z'), tx);
      expect(await ours()).toEqual(['acted', 'not_needed']);
      expect(await targets(tx, p.base)).toHaveLength(1);
    });
  });

  it('형제 원본의 주문이 셀메이트로 출고되면 실행 모드여도 합포장하지 않는다(D16 은 원본 전부에 건다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, consolidation, rule, runner } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.salesOrders.id, p.second.salesOrderId));
      const now = new Date('2099-06-01T00:00:00.000Z');
      await project(tx, dbs, [p.first.salesOrderId, p.second.salesOrderId], now);

      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
      await runner.runRule(acting(rule), now, tx);

      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBe(p.operationId);
      expect(await targets(tx, p.base)).toHaveLength(0);
    });
  });
});
