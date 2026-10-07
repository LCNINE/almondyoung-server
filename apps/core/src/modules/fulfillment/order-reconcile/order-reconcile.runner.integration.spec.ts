// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { OrderReconcileRule } from './order-reconcile.rule';
import { OrderReconcileRunner } from './order-reconcile.runner';
import { ReconcileMode } from './order-reconcile.state';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function seedProgress(tx: DbTx, args: { stage: string | null; state: string; outcome?: string | null }) {
  const o = await f.seedOrder(tx);
  const at = new Date('2000-01-01T00:00:00Z');
  await tx.insert(wmsTables.orderProgress).values({
    salesOrderId: o.salesOrderId,
    salesChannel: 'medusa',
    orderedAt: at,
    stage: args.stage,
    state: args.state,
    stageEnteredAt: at,
    outcome: args.outcome ?? null,
    closedAt: args.outcome ? at : null,
    evaluatedAt: at,
  });
  return o.salesOrderId;
}

function fakeRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<void>) {
  const rule: OrderReconcileRule = {
    name: `it-runner-${state}`,
    row: 99,
    mode,
    situation: { stage: 'fo', states: [state] },
    fingerprint: jest.fn(async () => 'fp'),
    check: jest.fn(async () => true),
    act: jest.fn(async (id: string) => act(id)),
  };
  return rule;
}

describeIfDb('OrderReconcileRunner (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });
  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const statesOf = async (tx: DbTx, rule: string) =>
    new Map(
      (await tx.select().from(wmsTables.orderReconcileState))
        .filter((r) => r.rule === rule)
        .map((r) => [r.salesOrderId, r]),
    );

  it('종료된 주문(셀메이트 출고)은 고르지 않는다 — backlog 가 awaiting_matching 이어도', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const shipped = await seedProgress(tx, { stage: null, state, outcome: 'external_shipped' });
      await f.seedBacklog(tx, shipped, 'awaiting_matching');
      const rule = fakeRule(state, 'act', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.acted).toBe(0);
      expect((await statesOf(tx, rule.name)).size).toBe(0);
    });
  });

  it('한 후보의 act 예외가 다른 후보를 막지 않고, 실패 행엔 error 가 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const bad = await seedProgress(tx, { stage: 'fo', state });
      const good = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async (id) => {
        if (id === bad) throw new Error('boom');
      });
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(summary).toMatchObject({ acted: 1, errors: 1 });
      const rows = await statesOf(tx, rule.name);
      expect(rows.get(bad)).toMatchObject({ lastResult: 'error', lastError: 'boom', attempts: 1 });
      expect(rows.get(good)).toMatchObject({ lastResult: 'acted', attempts: 1 });
    });
  });

  it('관찰 모드는 act 를 부르지 않고 would_act 를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'observe', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.wouldAct).toBe(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'would_act', mode: 'observe', attempts: 0 });
    });
  });

  it('check 가 false 면 not_needed 로 남기고 act 하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => undefined);
      (rule.check as jest.Mock).mockResolvedValue(false);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.notNeeded).toBe(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed', attempts: 0 });
    });
  });

  it('상황을 떠난 주문의 행은 다음 바퀴에 지워진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => undefined);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);
      await runner.runRule(rule, NOW, tx);
      await tx
        .update(wmsTables.orderProgress)
        .set({ stage: 'reserve', state: 'created' })
        .where(eq(wmsTables.orderProgress.salesOrderId, id));

      const summary = await runner.runRule(rule, new Date('2099-06-01T01:00:00.000Z'), tx);

      expect(summary.departed).toBe(1);
      expect((await statesOf(tx, rule.name)).size).toBe(0);
    });
  });
});

