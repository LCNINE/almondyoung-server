import { randomUUID } from 'crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 반납이 섞인 세션 (PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 두 번째 박스 배정 전량을 반납한다. withAllocationUpdate=false 면 배정 행을 그대로 둔다(드리프트). */
  async function handBackSecond(tx: DbTx, withAllocationUpdate: boolean) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
    await wiring.sessions.handBack(
      {
        sessionId: started.sessionId,
        operationId: randomUUID(),
        actorId: second.actorId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
        skuId: second.skuId,
        sourceLocationId: second.locationId,
        quantity: allocation.qty,
      },
      tx,
    );
    if (withAllocationUpdate) {
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    }
    return { wiring, sessionId: started.sessionId, allocation };
  }

  it('반납과 배정 감소가 함께 있으면 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await handBackSecond(tx, true);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true, issues: [] });
    });
  });

  it('반납은 했는데 배정 행이 그대로면 배정별 합 불일치로 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await handBackSecond(tx, false);
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toContain(`allocation ${allocation.id} quantity`);
    });
  });

  it('HAND_BACK payload 의 배정 신원이 틀리면 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await handBackSecond(tx, true);
      await tx.execute(
        rawSql`UPDATE batch_inventory_session_events
                  SET payload = jsonb_set(payload, '{allocationId}', to_jsonb(${randomUUID()}::text))
                WHERE session_id = ${sessionId}::uuid AND event_type = 'HAND_BACK'`,
      );
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.issues.join('\n')).toMatch(/HAND_BACK event .* allocation attribution/);
    });
  });
});
