import { randomUUID } from 'crypto';
import { and, eq, sql as rawSql } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../services/__support__';
import { seedPickableShipment } from '../../services/__support__/logistics-fixtures';
import { seedTwoBoxBatch } from '../../services/__support__/simple-outbound-fixtures';
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
      ).rejects.toMatchObject({ response: { code: 'BATCH_START_BLOCKED' } });

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

  // 롤링 배포 중 옛 태스크가 시작한 배치: started_at 은 NULL 인데 옛 코드가 연 세션이 열려 있고, 작업 항목은
  // 아직 queued 다. 배정까지 가면 옛 세션의 AT_SOURCE 가 가용을 깎거나 startSession 이 날 409 를 낸다.
  it('시작 전 배치에 옛 코드가 연 세션이 열려 있으면 PICKING_BATCH_STATE_CORRUPT 이고 배정을 남기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      const [legacy] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: first.batchId, status: 'active' })
        .returning();
      const { picking } = assembleOutbound(tx);

      await expect(
        tx.transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx),
        ),
      ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_STATE_CORRUPT' } });

      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(
          rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
        );
      expect(allocations).toHaveLength(0);
      const sessions = await tx
        .select({ id: wmsTables.batchInventorySessions.id })
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, first.batchId));
      expect(sessions).toEqual([{ id: legacy.id }]);
      const [batch] = await tx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).toBeNull();
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

  it('한 줄이 모자라면 그 줄만 STOCK_SHORT 로 보고하고 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 2 + 3 > 4 — 둘 다 혼자서는 채울 수 있어 가장 앞선 줄 id 의 박스가 이긴다. 줄 id 가 무작위라 어느 박스가
      // 막히는지는 달라지지만 막힌 박스는 정확히 하나, 남은 용량으로 재어 1개 부족이다.
      const { first, second } = await seedTwoBoxBatch(tx, 3, 4);
      const { picking } = assembleOutbound(tx);
      const error = await tx
        .transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx),
        )
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'BATCH_START_BLOCKED' } });
      const errors = (error as { response: { errors: Array<Record<string, unknown>> } }).response.errors;
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ reason: 'STOCK_SHORT', shortQty: 1 });
      expect([first.shipmentId, second.shipmentId]).toContain(errors[0].shipmentId);
      expect(errors[0].skuCode).toBe(first.skuCode);
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(
          rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`,
        );
      expect(allocations).toEqual([]);
      const [batch] = await tx
        .select()
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).toBeNull();
    });
  });

  it('스스로 못 채우는 박스만 막히고, 그 박스가 쥔 일부 몫 때문에 다른 박스가 보고되지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 재고 4 — first 2개는 채울 수 있고 second 5개는 혼자서도 못 채운다. 줄 id 순과 무관하게 second 만 막히고,
      // 부족분은 first 가 쓰고 남은 2 로 잰 3 이다.
      const { first, second } = await seedTwoBoxBatch(tx, 5, 4);
      const { picking } = assembleOutbound(tx);
      const error = await tx
        .transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx),
        )
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'BATCH_START_BLOCKED' } });
      const errors = (error as { response: { errors: Array<Record<string, unknown>> } }).response.errors;
      expect(errors).toEqual([
        expect.objectContaining({ shipmentId: second.shipmentId, reason: 'STOCK_SHORT', requiredQty: 5, shortQty: 3 }),
      ]);
    });
  });

  it('송장이 무효인 박스와 재고가 모자란 줄을 한 번에 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 3, 4);
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, first.waybillId));
      const { picking } = assembleOutbound(tx);
      const error = await tx
        .transaction((trx) =>
          picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, trx),
        )
        .catch((e: unknown) => e);
      const errors = (error as { response: { errors: Array<{ shipmentId: string; reason: string }> } }).response.errors;
      expect(errors.some((b) => b.shipmentId === first.shipmentId && b.reason === 'WAYBILL_NOT_READY')).toBe(true);
      expect(errors.some((b) => b.reason === 'STOCK_SHORT')).toBe(true);
      expect(errors.every((b) => [first.shipmentId, second.shipmentId].includes(b.shipmentId))).toBe(true);
    });
  });

  it('E8: 한 로케이션에서 전량 가능한 곳이 있으면 코드가 앞선 1개짜리 로케이션을 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      // 픽스처 로케이션 코드는 `IT-Z-…` — 그보다 앞서는 `AAA-…` 에 1개를 둔다
      const [early] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: box.warehouseId, code: `AAA-${randomUUID()}`, locationType: 'zone' })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: box.skuId,
        warehouseId: box.warehouseId,
        locationId: early.id,
        stockState: 'ON_HAND',
        qty: 1,
      });
      const { picking } = assembleOutbound(tx);
      await picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(allocations.map((row) => [row.sourceLocationId, row.qty])).toEqual([[box.locationId, 2]]);
    });
  });
});
