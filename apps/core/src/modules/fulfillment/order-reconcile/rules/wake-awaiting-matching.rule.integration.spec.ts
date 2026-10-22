// apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, seedMatching, wireLogistics } from '../../services/__support__';
import { recordSalesOrderCancellation } from '../../../sales-order/cancellation-record/record-cancellation';
import { wireCancellation } from '../../../sales-order/cancellation-record/__support__/cancellation-scenarios';
import { readLineQuantities } from '../../../sales-order/line-quantities/line-quantities.reader';
import * as f from '../../order-progress/__support__/order-progress.fixtures';
import { OrderProgressManager } from '../../order-progress/order-progress.manager';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRepository } from '../order-reconcile.repository';
import { OrderReconcileRunner } from '../order-reconcile.runner';
import { ShipmentReconcileRepository } from '../shipment-reconcile.repository';
import { ReconcileMode } from '../order-reconcile.state';
import { WakeAwaitingMatchingRule } from './wake-awaiting-matching.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const gate = (mode: 'v2' | 'maintenance') =>
  new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
  );

/** 매칭 대기 주문 하나: 라인 variant 하나, backlog awaiting_matching(그 variant 를 기다림). */
async function seedAwaiting(tx: DbTx, waiting: unknown = undefined) {
  const order = await f.seedOrder(tx, { status: 'confirmed', createdAt: new Date('2000-01-01T00:00:00Z') });
  const [line] = await tx
    .select({ variantId: wmsTables.salesOrderLines.variantId })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.salesOrderId, order.salesOrderId));
  await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({
    salesOrderId: order.salesOrderId,
    status: 'awaiting_matching',
    waitingVariantIds: waiting === undefined ? [line.variantId] : waiting,
    // 투영의 fo 진입 시각 추정이 backlog created_at 이다 — 아주 오래되게 해 다른 행보다 먼저 고르게 한다
    createdAt: new Date('2000-01-01T00:00:00Z'),
  });
  return { salesOrderId: order.salesOrderId, variantId: line.variantId };
}

async function backlogStatus(tx: DbTx, salesOrderId: string) {
  const [row] = await tx
    .select({ status: wmsTables.fulfillmentOrderCreationBacklogs.status })
    .from(wmsTables.fulfillmentOrderCreationBacklogs)
    .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));
  return row?.status;
}

describeIfDb('WakeAwaitingMatchingRule (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(mode: 'v2' | 'maintenance' = 'v2') {
    const dbs = makeDbService(db);
    const w = wireLogistics(dbs);
    const rule = new WakeAwaitingMatchingRule(w.backlog, gate(mode), w.lineCompositions);
    return { dbs, w, rule };
  }

  it('기다리던 variant 가 모두 쓸 수 있게 매칭되면 check true → act 가 pending 으로 깨운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });

      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
      expect(await rule.act(o.salesOrderId, tx)).toBe('acted');
      // 이미 pending 이라 CAS 가 진다 — 할 일이 없었음을 알린다
      expect(await rule.act(o.salesOrderId, tx)).toBe('noop');
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('pending');
    });
  });

  it('하나라도 미매칭이면 not_needed(check false)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('링크 0개 매칭을 기다리면 not_needed — 깨우면 워커가 곧장 되돌려 헛돈다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      await tx
        .insert(wmsTables.productMatchings)
        .values({ variantId: o.variantId, status: 'matched', strategy: 'variant', isResolved: true });
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('라인이 미매칭이면 대기 목록 모양과 무관하게 not_needed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const empty = await seedAwaiting(tx, []);
      const garbage = await seedAwaiting(tx, { not: 'an array' });
      expect(await rule.check(empty.salesOrderId, tx)).toBe(false);
      expect(await rule.check(garbage.salesOrderId, tx)).toBe(false);
    });
  });

  it('backlog 가 이미 awaiting_matching 이 아니면(투영이 늦음) not_needed', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'pending' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('정비 모드면 not_needed — 일시적 막힘은 시도로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire('maintenance');
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('지문은 기존 매칭의 링크를 upsert 로 고치면 바뀌고, 그대로면 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, rule } = wire();
      const world = await f.seedWorld(tx);
      const other = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      const f1 = await rule.fingerprint(o.salesOrderId, tx);
      expect(await rule.fingerprint(o.salesOrderId, tx)).toBe(f1);

      // 실제 경로: upsert 는 product_matchings.updated_at 을 올리지 않고 링크만 갈아끼운다
      await w.productSkuMapping.upsert(
        o.variantId,
        {
          links: [{ skuId: other.skuId, quantity: 2 }],
          policy: { preStockSellable: true, alwaysSellableZeroStock: false },
        },
        tx,
      );
      expect(await rule.fingerprint(o.salesOrderId, tx)).not.toBe(f1);
    });
  });

  it('투영 → 러너 → 규칙 끝까지: 등록된 규칙(실행 모드)은 깨우고, 관찰 모드면 그대로 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, rule } = wire();
      expect(rule.mode).toBe('act');
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      const now = new Date('2099-06-01T00:00:00.000Z');
      await new OrderProgressManager(dbs).refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
      const runner = new OrderReconcileRunner(
        dbs,
        new OrderReconcileRepository(dbs),
        new ShipmentReconcileRepository(dbs),
        new OrderProgressReader(dbs),
        [rule],
      );

      // 관찰 모드(첫 배포 때의 상태를 흉내): 깨우지 않는다
      class ObservingRule extends WakeAwaitingMatchingRule {
        readonly mode: ReconcileMode = 'observe';
      }
      const observing = new ObservingRule(w.backlog, gate('v2'), w.lineCompositions);
      const observed = await runner.runRule(observing, now, tx);
      expect(observed.wouldAct).toBeGreaterThanOrEqual(1);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('awaiting_matching');

      const acted = await runner.runRule(rule, new Date('2099-06-01T00:11:00.000Z'), tx);
      expect(acted.acted).toBeGreaterThanOrEqual(1);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('pending');
    });
  });

  it('게이트: 투영 뒤 판매주문이 셀메이트로 출고되면 실행 모드여도 깨우지 않는다 — check 만으로는 true 였을 상태', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      const now = new Date('2099-06-01T00:00:00.000Z');
      await new OrderProgressManager(dbs).refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
      // 투영은 fo/awaiting_matching 인 채로, 원천만 외부 출고로 바뀐다(셀메이트 스크립트)
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.salesOrders.id, o.salesOrderId));
      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
      const runner = new OrderReconcileRunner(
        dbs,
        new OrderReconcileRepository(dbs),
        new ShipmentReconcileRepository(dbs),
        new OrderProgressReader(dbs),
        [rule],
      );

      await runner.runRule(rule, now, tx);

      expect(await backlogStatus(tx, o.salesOrderId)).toBe('awaiting_matching');
      const rows = await tx
        .select()
        .from(wmsTables.orderReconcileState)
        .where(eq(wmsTables.orderReconcileState.salesOrderId, o.salesOrderId));
      // 기록이 없던 후보라 not_needed 로 남겨 10분 물러난다 — 시도로 세지 않는다
      expect(rows).toEqual([expect.objectContaining({ lastResult: 'not_needed', attempts: 0 })]);
    });
  });

  it('상품매칭은 미해결이어도 운영자가 라인을 굳혔으면 풀린 주문이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: new Date() })
        .where(eq(wmsTables.salesOrderLines.id, line.id));
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: line.id, skuId: world.skuId, qtyPerUnit: 1 });

      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
    });
  });

  it('전량 취소된 미매칭 라인은 막지 않는다 — FO 생성과 같은 판정', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id, quantity: wmsTables.salesOrderLines.quantity })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: o.salesOrderId,
          cancellationScope: 'partial',
          reasonCode: 'it',
        },
        [{ salesOrderLineId: line.id, quantity: line.quantity }],
      );
      // 전제: 취소 기록 문이 라인 전량을 출고 전 취소로 남겼다 — 리더는 이 라인 행만 본다(K6 PR2a)
      expect((await readLineQuantities(tx, o.salesOrderId)).get(line.id)).toMatchObject({
        canceledBeforeShipment: line.quantity,
        demand: 0,
      });
      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
    });
  });

  // E1 로 리더가 V1 전체취소도 세게 되면서 전체취소 주문의 미매칭 라인도 더는 막지 않는다(유효 수량 0).
  // 그래도 리컨실러 대상이 아닌 까닭은 전체취소가 같은 트랜잭션에서 백로그를 닫기 때문이다 — 그 전제를 고정한다
  it('V1 전체취소는 매칭 대기 백로그를 닫아 깨울 대상이 아니다 — 막는 라인이 없어져도', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule, w } = wire();
      const o = await seedAwaiting(tx);
      await wireCancellation(tx).salesOrders.cancel(o.salesOrderId, { cancelledBy: 'it' }, tx);

      const resolved = await w.lineCompositions.resolveForOrder(o.salesOrderId, tx);
      expect(resolved.map((r) => [r.fulfillableQuantity, r.resolution.kind])).toEqual([[0, 'missing']]);
      expect(await backlogStatus(tx, o.salesOrderId)).toBe('not_required');
      expect(await rule.check(o.salesOrderId, tx)).toBe(false);
    });
  });

  it('지문은 라인을 굳히면 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      const before = await rule.fingerprint(o.salesOrderId, tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: new Date() })
        .where(eq(wmsTables.salesOrderLines.id, line.id));
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: line.id, skuId: world.skuId, qtyPerUnit: 1 });
      expect(await rule.fingerprint(o.salesOrderId, tx)).not.toBe(before);
    });
  });
});
