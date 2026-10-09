import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { ReconcileRuleRef } from './order-reconcile.rule';
import { ShipmentReconcileRepository } from './shipment-reconcile.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function seedShipmentId(tx: DbTx): Promise<string> {
  const w = await f.seedWorld(tx);
  const o = await f.seedOrder(tx);
  const fo = await f.seedFo(tx, w, o);
  return (await f.seedBox(tx, w, [fo.foItemId], { status: 'recovery_required', recoveryCode: 'CONSOLIDATION_PENDING' }))
    .shipmentId;
}

const record = (over: Partial<Parameters<ShipmentReconcileRepository['save']>[2]> = {}) => ({
  fingerprint: 'fp',
  mode: 'act' as const,
  attempts: 1,
  lastResult: 'acted' as const,
  lastError: null,
  gaveUpAt: null,
  nextCheckAt: new Date('2099-01-01T00:00:00.000Z'),
  ...over,
});

describeIfDb('ShipmentReconcileRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });
  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const ruleRef = (): ReconcileRuleRef => ({
    name: `it-box-${randomUUID().slice(0, 8)}`,
    row: 98,
    situation: { stage: 'pick', states: ['CONSOLIDATION_PENDING'] },
  });

  it('후보: 받은 순서를 지키고, 볼 때가 안 된 행은 건너뛰고, 된 행은 이전 상태와 함께, 상한까지', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const rule = ruleRef();
      const a = await seedShipmentId(tx);
      const b = await seedShipmentId(tx);
      const c = await seedShipmentId(tx);
      const d = await seedShipmentId(tx);
      await repo.save(rule, b, record({ nextCheckAt: new Date('2099-06-01T00:05:00.000Z') }), NOW, tx); // 아직
      await repo.save(rule, c, record({ nextCheckAt: new Date('2099-05-31T23:59:00.000Z'), attempts: 2 }), NOW, tx); // 됨

      const got = await repo.candidates(rule, [a, b, c, d], NOW, 2, tx);

      expect(got.map((x) => x.shipmentId)).toEqual([a, c]);
      expect(got[0].prior).toBeNull();
      expect(got[1].prior).toMatchObject({ attempts: 2, lastResult: 'acted', fingerprint: 'fp' });
      expect(await repo.candidates(rule, [], NOW, 50, tx)).toEqual([]);
    });
  });

  it('떠남: 칸에 남은 상자는 지우지 않고, 막 acted 한 행은 유예 동안 남기며, 남은 상자가 0개면 유예 밖 행을 다 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const rule = ruleRef();
      const stays = await seedShipmentId(tx);
      const left = await seedShipmentId(tx);
      const justActed = await seedShipmentId(tx);
      const old = new Date('2099-05-31T00:00:00.000Z');
      await repo.save(rule, stays, record({ lastResult: 'not_needed' }), old, tx);
      await repo.save(rule, left, record({ lastResult: 'not_needed' }), old, tx);
      await repo.save(rule, justActed, record({ lastResult: 'acted' }), new Date('2099-05-31T23:55:00.000Z'), tx);

      expect(await repo.deleteDeparted(rule, [stays], NOW, tx)).toBe(1);
      expect(await repo.deleteDeparted(rule, [], NOW, tx)).toBe(1); // stays 만 지워진다 — justActed 는 유예 안
      const remaining = await tx.select().from(wmsTables.shipmentReconcileState);
      expect(remaining.filter((r) => r.rule === rule.name).map((r) => r.shipmentId)).toEqual([justActed]);
    });
  });

  it('save 는 upsert 이고 tracking_row 를 남기며, deleteUnregistered 는 이름 없는 규칙의 행만 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const kept = ruleRef();
      const gone = ruleRef();
      const id = await seedShipmentId(tx);
      await repo.save(kept, id, record({ attempts: 1 }), NOW, tx);
      await repo.save(kept, id, record({ attempts: 3 }), NOW, tx);
      await repo.save(gone, id, record(), NOW, tx);

      const removed = await repo.deleteUnregistered([kept.name], tx);

      expect(removed).toBeGreaterThanOrEqual(1);
      const rows = (await tx.select().from(wmsTables.shipmentReconcileState)).filter((r) => r.shipmentId === id);
      expect(rows).toEqual([expect.objectContaining({ rule: kept.name, attempts: 3, trackingRow: 98 })]);
    });
  });
});
