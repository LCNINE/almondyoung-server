import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { shortageIdempotencyKey } from './batch-inventory-session.service';
import { inRollbackTx, makeDb } from './__support__';
import { seedShortPickOperation } from './__support__/short-pick-fixtures';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 새 부족 승인 (PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 첫 박스(2개)의 배정에서 1 을 부족 승인하고 배정도 1 줄인다 — BoxAllocationManager.approveShortages 가 하는 일. */
  async function approvedOne(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
    const operation = await seedShortPickOperation(tx, {
      shipmentId: first.shipmentId,
      workItemId: first.workItemId,
      sessionId: run.sessionId,
      actorId: first.actorId,
      lines: [
        { shipmentLineId: first.shipmentLineId, sourceLocationId: first.locationId, shortQty: 1, allocationQty: 2 },
      ],
    });
    await wiring.sessions.approveShortage(
      {
        sessionId: run.sessionId,
        idempotencyKey: shortageIdempotencyKey(operation.id, allocation.id),
        shortPickOperationId: operation.id,
        workItemId: first.workItemId,
        allocationId: allocation.id,
        shipmentLineId: first.shipmentLineId,
        quantity: 1,
        from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
        reasonCode: 'MISSING',
        reason: operation.reason,
        approverId: first.actorId,
      },
      tx,
    );
    await tx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: 1 })
      .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    return { first, second, wiring, sessionId: run.sessionId, allocation };
  }

  it('인계 − 반납 − 바구니 − 새 부족 승인 = 배정이면 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await approvedOne(tx);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it('배정 행이 부족 승인만큼 줄지 않았으면 그 배정을 짚는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await approvedOne(tx);
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 2 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toContain(`allocation ${allocation.id} quantity 2 differs`);
    });
  });
});
