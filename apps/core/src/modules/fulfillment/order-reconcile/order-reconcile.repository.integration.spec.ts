import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ReconcileRuleRef } from './order-reconcile.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 투영 행을 직접 넣는다 — 판정 SQL 이 아니라 저장소의 후보 선택만 본다. state 는 테스트마다 고유하게 해 다른 행과 섞이지 않게 한다. */
async function seedProgress(
  tx: DbTx,
  args: { stage: string | null; state: string; outcome?: string | null; enteredAt: Date },
): Promise<string> {
  const o = await f.seedOrder(tx);
  await tx.insert(wmsTables.orderProgress).values({
    salesOrderId: o.salesOrderId,
    salesChannel: 'medusa',
    orderedAt: args.enteredAt,
    stage: args.stage,
    state: args.state,
    stageEnteredAt: args.enteredAt,
    outcome: args.outcome ?? null,
    closedAt: args.outcome ? args.enteredAt : null,
    evaluatedAt: args.enteredAt,
  });
  return o.salesOrderId;
}

const record = (over: Partial<Parameters<OrderReconcileRepository['save']>[2]> = {}) => ({
  fingerprint: 'fp',
  mode: 'act' as const,
  attempts: 1,
  lastResult: 'acted' as const,
  lastError: null,
  gaveUpAt: null,
  nextCheckAt: new Date('2099-01-01T00:00:00.000Z'),
  ...over,
});

describeIfDb('OrderReconcileRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });

  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const ruleFor = (state: string): ReconcileRuleRef => ({
    name: `it-rule-${state}`,
    row: 99,
    situation: { stage: 'fo', states: [state] },
  });

  it('후보는 진행 중 + 같은 칸만, 오래된 순, 상한까지', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const oldest = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const middle = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-02T00:00:00Z') });
      await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-03T00:00:00Z') });
      // 셀메이트 출고처럼 종료된 주문은 같은 state 문자열이어도 고르지 않는다
      await seedProgress(tx, { stage: null, state, outcome: 'external_shipped', enteredAt: new Date('1999-01-01T00:00:00Z') });
      // 다른 단계
      await seedProgress(tx, { stage: 'plan', state, enteredAt: new Date('1999-01-01T00:00:00Z') });

      const got = await repo.candidates(ruleFor(state), NOW, 2, tx);
      expect(got.map((c) => c.salesOrderId)).toEqual([oldest, middle]);
      expect(got.every((c) => c.prior === null)).toBe(true);
    });
  });

  it('next_check_at 이 안 된 행은 건너뛰고, 된 행은 이전 상태와 함께 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const later = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const due = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-02T00:00:00Z') });
      await repo.save(rule, later, record({ nextCheckAt: new Date('2099-06-01T00:10:00Z') }), NOW, tx);
      await repo.save(
        rule,
        due,
        record({ attempts: 2, lastResult: 'error', lastError: 'boom', nextCheckAt: new Date('2099-05-31T23:59:00Z') }),
        NOW,
        tx,
      );

      const got = await repo.candidates(rule, NOW, 50, tx);
      expect(got).toEqual([
        {
          salesOrderId: due,
          prior: { fingerprint: 'fp', mode: 'act', attempts: 2, lastResult: 'error', lastError: 'boom', gaveUpAt: null },
        },
      ]);
    });
  });

  it('save 는 upsert 하고 first_seen_at 은 처음 값을 지킨다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const id = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      await repo.save(rule, id, record(), new Date('2099-01-01T00:00:00Z'), tx);
      await repo.save(rule, id, record({ attempts: 2 }), new Date('2099-01-02T00:00:00Z'), tx);

      const rows = await tx.select().from(wmsTables.orderReconcileState);
      const ours = rows.filter((r) => r.salesOrderId === id);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({
        rule: rule.name,
        trackingRow: 99,
        attempts: 2,
        firstSeenAt: new Date('2099-01-01T00:00:00Z'),
        updatedAt: new Date('2099-01-02T00:00:00Z'),
      });
    });
  });

  it('deleteDeparted 는 그 규칙의 상황을 떠난 주문 행만 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const stays = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      const left = await seedProgress(tx, { stage: 'reserve', state: 'created', enteredAt: new Date('2000-01-01T00:00:00Z') });
      const closed = await seedProgress(tx, { stage: null, state, outcome: 'delivered', enteredAt: new Date('2000-01-01T00:00:00Z') });
      for (const id of [stays, left, closed]) await repo.save(rule, id, record(), NOW, tx);

      // 유예(10분)가 지난 시각 — 유예는 아래 테스트가 본다
      expect(await repo.deleteDeparted(rule, new Date('2099-06-01T01:00:00.000Z'), tx)).toBe(2);
      const remaining = (await tx.select().from(wmsTables.orderReconcileState)).filter((r) => r.rule === rule.name);
      expect(remaining.map((r) => r.salesOrderId)).toEqual([stays]);
    });
  });

  it('deleteDeparted 는 막 깨웠거나 실패한 행을 10분 동안 남긴다 — 깨운 직후의 pending 을 «떠남»으로 보지 않게', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const rule = ruleFor(state);
      const leave = () => seedProgress(tx, { stage: 'fo', state: 'pending', enteredAt: new Date('2000-01-01T00:00:00Z') });
      const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
      const acted5 = await leave();
      const error5 = await leave();
      const acted11 = await leave();
      const notNeeded5 = await leave();
      await repo.save(rule, acted5, record({ lastResult: 'acted' }), minAgo(5), tx);
      await repo.save(rule, error5, record({ lastResult: 'error', lastError: 'boom' }), minAgo(5), tx);
      await repo.save(rule, acted11, record({ lastResult: 'acted' }), minAgo(11), tx);
      await repo.save(rule, notNeeded5, record({ lastResult: 'not_needed' }), minAgo(5), tx);

      expect(await repo.deleteDeparted(rule, NOW, tx)).toBe(2);
      const remaining = (await tx.select().from(wmsTables.orderReconcileState))
        .filter((r) => r.rule === rule.name)
        .map((r) => r.salesOrderId);
      expect(remaining.sort()).toEqual([acted5, error5].sort());
    });
  });

  it('deleteUnregistered 는 등록되지 않은 규칙의 행만 지우고, 이름이 없으면 전부 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new OrderReconcileRepository(makeDbService(db));
      const state = `it_${randomUUID().slice(0, 8)}`;
      const kept = ruleFor(`${state}-kept`);
      const gone = ruleFor(`${state}-gone`);
      const id = await seedProgress(tx, { stage: 'fo', state, enteredAt: new Date('2000-01-01T00:00:00Z') });
      await repo.save(kept, id, record(), NOW, tx);
      await repo.save(gone, id, record(), NOW, tx);
      const ours = async () =>
        (await tx.select().from(wmsTables.orderReconcileState))
          .filter((r) => r.salesOrderId === id)
          .map((r) => r.rule);

      expect(await repo.deleteUnregistered([kept.name], tx)).toBeGreaterThanOrEqual(1);
      expect(await ours()).toEqual([kept.name]);

      await repo.deleteUnregistered([], tx);
      expect(await ours()).toEqual([]);
    });
  });
});
