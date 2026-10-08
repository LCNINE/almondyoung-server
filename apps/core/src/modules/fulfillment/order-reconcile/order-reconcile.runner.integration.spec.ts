// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ReconcileActResult, RunnableReconcileRule } from './order-reconcile.rule';
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

function fakeRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<ReconcileActResult>) {
  const rule: RunnableReconcileRule = {
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
      const rule = fakeRule(state, 'act', async () => 'acted');
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
        return 'acted';
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
      const rule = fakeRule(state, 'observe', async () => 'acted');
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
      const rule = fakeRule(state, 'act', async () => 'acted');
      (rule.check as jest.Mock).mockResolvedValue(false);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.notNeeded).toBe(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed', attempts: 0 });
    });
  });

  /** 매 바퀴를 그 행의 next_check_at 에 돌린다 — 백오프를 건너뛰지 않고 n 번째 시도까지 간다 */
  const runTimes = async (runner: OrderReconcileRunner, rule: RunnableReconcileRule, id: string, n: number, tx: DbTx) => {
    let at = NOW;
    for (let i = 0; i < n; i++) {
      await runner.runRule(rule, at, tx);
      const row = (await statesOf(tx, rule.name)).get(id);
      if (!row) throw new Error(`row missing after run ${i + 1}`);
      at = row.nextCheckAt;
    }
    return (await statesOf(tx, rule.name)).get(id);
  };

  it('act 가 늘 던지면 여섯 번째 바퀴에 포기한다 — 첫 예외의 지문도 실제 지문으로 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => {
        throw new Error('act boom');
      });
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const row = await runTimes(runner, rule, id, 6, tx);

      expect(rule.act).toHaveBeenCalledTimes(5);
      expect(row).toMatchObject({ fingerprint: 'fp', attempts: 5, lastResult: 'error', lastError: 'act boom' });
      expect(row?.gaveUpAt).not.toBeNull();
    });
  });

  it('check 가 늘 던져도 여섯 번째 바퀴에 포기하고, 마지막 오류는 이번 예외다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
      let calls = 0;
      (rule.check as jest.Mock).mockImplementation(async () => {
        calls++;
        throw new Error(`check boom ${calls}`);
      });
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const row = await runTimes(runner, rule, id, 6, tx);

      expect(rule.act).not.toHaveBeenCalled();
      expect(row).toMatchObject({ attempts: 5, lastResult: 'error', lastError: 'check boom 6' });
      expect(row?.gaveUpAt).not.toBeNull();
    });
  });

  it('첫 방문에 fingerprint 가 던지면 빈 지문으로 남기고, 다음 바퀴에 성공하면 실제 지문으로 이어간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
      (rule.fingerprint as jest.Mock).mockRejectedValueOnce(new Error('fp boom'));
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      await runner.runRule(rule, NOW, tx);
      const first = (await statesOf(tx, rule.name)).get(id);
      expect(first).toMatchObject({ fingerprint: '', attempts: 1, lastResult: 'error', lastError: 'fp boom' });

      await runner.runRule(rule, first?.nextCheckAt ?? NOW, tx);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({
        fingerprint: 'fp',
        attempts: 1,
        lastResult: 'acted',
        lastError: null,
      });
    });
  });

  it('지문이 바뀐 바퀴에 act 가 던지면 새 지문으로 1 회부터 다시 센다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const repo = new OrderReconcileRepository(dbs);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => {
        throw new Error('still boom');
      });
      (rule.fingerprint as jest.Mock).mockResolvedValue('b');
      await repo.save(
        rule,
        id,
        {
          fingerprint: 'a',
          mode: 'act',
          attempts: 3,
          lastResult: 'error',
          lastError: 'old boom',
          gaveUpAt: null,
          nextCheckAt: new Date('2099-05-31T00:00:00.000Z'),
        },
        new Date('2099-05-31T00:00:00.000Z'),
        tx,
      );
      const runner = new OrderReconcileRunner(dbs, repo, [rule]);

      await runner.runRule(rule, NOW, tx);

      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({
        fingerprint: 'b',
        attempts: 1,
        lastResult: 'error',
        lastError: 'still boom',
      });
    });
  });

  it('runAll 은 먼저 등록되지 않은 규칙(이름을 바꿨거나 뺀)의 행을 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const repo = new OrderReconcileRepository(dbs);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
      (rule.check as jest.Mock).mockResolvedValue(false);
      const stale = { name: `it-stale-${state}`, row: 98, situation: { stage: 'fo' as const, states: [state] } };
      await repo.save(
        stale,
        id,
        {
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          gaveUpAt: NOW,
          nextCheckAt: NOW,
        },
        NOW,
        tx,
      );
      const runner = new OrderReconcileRunner(dbs, repo, [rule]);

      await runner.runAll(NOW, tx);

      expect((await statesOf(tx, stale.name)).size).toBe(0);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed' });
    });
  });

  it('상황을 떠난 주문의 행은 다음 바퀴에 지워진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
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

  it('act 가 noop 이면(사람이 먼저 처리) not_needed 로 남기고 횟수를 올리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'noop');
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).toHaveBeenCalledTimes(1);
      expect(summary).toMatchObject({ acted: 0, notNeeded: 1 });
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed', attempts: 0 });
    });
  });

  it('포기한 주문에서 act 가 noop 이면 포기 표시와 횟수를 지키고 10분 뒤 다시 본다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const repo = new OrderReconcileRepository(dbs);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'noop');
      const gaveUpAt = new Date('2099-05-31T00:00:00.000Z');
      await repo.save(
        rule,
        id,
        { fingerprint: 'fp', mode: 'act', attempts: 5, lastResult: 'acted', lastError: null, gaveUpAt, nextCheckAt: NOW },
        gaveUpAt,
        tx,
      );
      const runner = new OrderReconcileRunner(dbs, repo, [rule]);

      await runner.runRule(rule, NOW, tx);

      expect(rule.act).toHaveBeenCalledTimes(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({
        lastResult: 'not_needed',
        attempts: 5,
        gaveUpAt,
        nextCheckAt: new Date('2099-06-01T00:10:00.000Z'),
      });
    });
  });
});
