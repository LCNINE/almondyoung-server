import { createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  createConsolidationSource,
  inRollbackTx,
  makeConsolidationService,
  makeDb,
  makeDbService,
  pendingConsolidationBlockedByWaybill,
  wireLogistics,
  Wired,
} from './__support__';
import { ConsolidationService } from './consolidation.service';
import { ConsolidationProgressReader } from './consolidation-progress.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ConsolidationProgressReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let consolidation: ConsolidationService;
  let reader: ConsolidationProgressReader;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
    ({ sql: client, db } = makeDb(DATABASE_URL));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    consolidation = makeConsolidationService(dbService, wired);
    reader = new ConsolidationProgressReader(dbService, consolidation);
  });

  afterAll(async () => {
    await client.end();
  });

  it('대기 중이면 원본별 막힘을, 끝나면 새 상자를 어느 원본으로 물어도 같이 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const p = await pendingConsolidationBlockedByWaybill(tx, wired, consolidation);
      const sourceA = p.first.shipment.id;
      const sourceB = p.second.shipment.id;

      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `consolidation-progress-${randomUUID()}`,
          warehouseId: p.base.warehouseId,
          pickingMethod: 'individual',
        })
        .returning();
      const [workItem] = await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId: batch.id, shipmentId: sourceA })
        .returning();
      const nextCheckAt = new Date('2026-10-29T02:00:00.000Z');
      const gaveUpAt = new Date('2026-10-29T01:00:00.000Z');
      await tx.insert(wmsTables.shipmentReconcileState).values({
        rule: 'resume-pending-consolidation',
        shipmentId: sourceA,
        trackingRow: 25,
        fingerprint: 'test',
        mode: 'act',
        attempts: 3,
        lastResult: 'error',
        nextCheckAt,
        gaveUpAt,
        firstSeenAt: gaveUpAt,
        updatedAt: gaveUpAt,
      });

      const pending = await reader.findForShipment(sourceA, tx);
      expect(pending).toMatchObject({ operationId: p.operationId, status: 'pending', targetShipmentId: null });
      expect(pending?.sources.map((s) => s.shipmentId).sort()).toEqual([sourceA, sourceB].sort());
      const a = pending?.sources.find((s) => s.shipmentId === sourceA);
      expect(a?.blockers).toEqual(expect.arrayContaining(['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM']));
      expect(a).toMatchObject({
        batchId: batch.id,
        workItemStatus: 'queued',
        waybillStatus: 'registered',
        gaveUpAt: gaveUpAt.toISOString(),
        nextCheckAt: nextCheckAt.toISOString(),
      });
      expect(typeof a?.trackingNo).toBe('string');
      expect(pending?.sources.find((s) => s.shipmentId === sourceB)).toMatchObject({
        blockers: [],
        batchId: null,
        waybillId: null,
        gaveUpAt: null,
      });
      expect(JSON.stringify(pending)).not.toContain('recipient');
      expect((await reader.findForShipment(sourceB, tx))?.operationId).toBe(pending?.operationId);

      await p.voidWaybill();
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'excluded' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      await consolidation.resumePending(p.operationId, tx);

      const done = await reader.findForShipment(sourceA, tx);
      expect(done).toMatchObject({ operationId: p.operationId, status: 'completed' });
      expect(typeof done?.targetShipmentId).toBe('string');
      expect(done?.sources.every((s) => s.blockers.length === 0)).toBe(true);
      expect(JSON.stringify(done)).not.toContain('recipient');
      expect((await reader.findForShipment(sourceB, tx))?.targetShipmentId).toBe(done?.targetShipmentId);

      // 더 최근 작업이 실패했으면 그 작업을 그대로 돌려준다. 오래된 완료 작업으로 바꿔치지 않는다
      const [failed] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          type: 'consolidate',
          status: 'failed',
          operatorId: randomUUID(),
          reason: 'newer failed consolidation',
          idempotencyKey: `consolidation-progress-failed-${randomUUID()}`,
          requestHash: createHash('sha256').update('consolidation-progress-failed').digest('hex'),
          lastError: 'consolidation failed for test',
          createdAt: new Date(Date.now() + 60_000),
        })
        .returning();
      await tx
        .insert(wmsTables.shipmentOperationMembers)
        .values({ operationId: failed.id, shipmentId: sourceA, role: 'source' });
      const latest = await reader.findForShipment(sourceA, tx);
      expect(latest).toMatchObject({ operationId: failed.id, status: 'failed', targetShipmentId: null });
      expect(latest?.sources.map((s) => s.shipmentId)).toEqual([sourceA]);
      expect((await reader.findForShipment(sourceB, tx))?.operationId).toBe(p.operationId);

      const unrelated = await createConsolidationSource(tx, wired, p.base, { quantity: 1, customerId: randomUUID() });
      expect(await reader.findForShipment(unrelated.shipment.id, tx)).toBeNull();
    });
  });
});
