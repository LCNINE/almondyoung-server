import { randomUUID } from 'crypto';
import { and, eq, sql as rawSql } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../services/__support__';
import { seedBoxOverSameStock, seedTwoBoxBatch } from '../../services/__support__/simple-outbound-fixtures';
import { assembleOutbound } from '../../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('배치 시작 (startBatchPicking)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('queued 박스 전부를 작업 항목 키로 배정하고 HAND_IN payload 에 배치·작업 항목·배정 신원을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      const { picking } = assembleOutbound(tx);

      const started = await picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );

      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(
          rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
        );
      expect(allocations.map((row) => [row.workItemId, row.qty]).sort()).toEqual(
        [
          [first.workItemId, 2],
          [second.workItemId, 3],
        ].sort(),
      );
      expect(allocations.every((row) => row.planId === null)).toBe(true);

      const handIns = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, started.sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      expect(handIns).toHaveLength(allocations.length);
      const byAllocation = new Map(allocations.map((row) => [row.id, row]));
      for (const event of handIns) {
        const payload = event.payload as Record<string, unknown>;
        expect(payload.batchId).toBe(first.batchId);
        expect(payload.workItemId).toBe(byAllocation.get(payload.allocationId as string)?.workItemId);
      }
      const [batch] = await tx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).not.toBeNull();
    });
  });

  it('같은 키·다른 키로 다시 시작해도 같은 세션이고 HAND_IN 이 늘지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx);
      const { picking } = assembleOutbound(tx);
      const key = `s-${randomUUID()}`;

      const a = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: key }, tx);
      const b = await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: key }, tx);
      const c = await picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );

      expect(new Set([a.sessionId, b.sessionId, c.sessionId]).size).toBe(1);
      const handIns = await tx
        .select({ id: wmsTables.batchInventorySessionEvents.id })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, a.sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      expect(handIns).toHaveLength(2);
    });
  });

  it('한 박스의 위치 재고가 모자라면 시작이 실패하고 배정·세션·시작 시각이 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 3, 4); // 2 + 3 > 4
      const { picking } = assembleOutbound(tx);

      // 실패한 시작이 바깥 롤백 트랜잭션을 망가뜨리지 않게 세이브포인트 안에서 실패시킨다.
      await expect(
        tx.transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'PICKING_SOURCE_INSUFFICIENT' } });

      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(
          rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
        );
      expect(allocations).toHaveLength(0);
      const sessions = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, first.batchId));
      expect(sessions).toHaveLength(0);
      const [batch] = await tx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).toBeNull();
    });
  });

  it('시작된 배치에 박스를 추가하면 OUTBOUND_BATCH_ALREADY_STARTED', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      const { picking, batches } = assembleOutbound(tx);
      await picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);

      const third = await seedBoxOverSameStock(tx, first, 1);
      await tx
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, third.workItemId));

      await expect(
        batches.addShipment(first.batchId, third.shipmentId, `add-${randomUUID()}`, {
          id: randomUUID(),
          roles: ['master'],
        }),
      ).rejects.toMatchObject({ response: { code: 'OUTBOUND_BATCH_ALREADY_STARTED' } });
    });
  });

  it('복구 reconcile 은 새 payload 로 시작된 세션을 건강하다고 판정한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx);
      const { picking, recovery } = assembleOutbound(tx);
      const started = await picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );

      await expect(recovery.reconcile(started.sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });

  it.each(['workItemId', 'batchId'] as const)(
    'HAND_IN payload 의 %s 가 배정·세션과 다르면 복구가 문제로 잡는다',
    async (field) => {
      await inRollbackTx(db, async (tx) => {
        const { first } = await seedTwoBoxBatch(tx);
        const { picking, recovery } = assembleOutbound(tx);
        const started = await picking.start(
          { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
          tx,
        );
        const [victim] = await tx
          .select({ id: wmsTables.batchInventorySessionEvents.id })
          .from(wmsTables.batchInventorySessionEvents)
          .where(
            and(
              eq(wmsTables.batchInventorySessionEvents.sessionId, started.sessionId),
              eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
            ),
          )
          .limit(1);
        // 바꿀 필드가 테스트마다 달라 jsonb_set 경로를 text[] 파라미터로 넘긴다.
        await tx
          .update(wmsTables.batchInventorySessionEvents)
          .set({ payload: rawSql`jsonb_set(payload, ARRAY[${field}]::text[], to_jsonb(${randomUUID()}::text))` })
          .where(eq(wmsTables.batchInventorySessionEvents.id, victim.id));

        const result = await recovery.reconcile(started.sessionId, tx);
        expect(result.healthy).toBe(false);
        expect(result.issues.join('\n')).toContain('differs from persisted allocation');
      });
    },
  );
});
