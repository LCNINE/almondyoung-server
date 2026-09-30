import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment, receiveStock, wireLogistics } from './__support__';
import { assembleOutbound, ambientDbService, startBatchFor } from './__support__/simple-outbound-wiring';

import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { isPreparationBlocked } from './outbound-preparation-result';
const authorization = {
  scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
  granted: true as const,
  [SCOPE_AUTHORIZATION_DECISION_BRAND]: true as const,
};
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !DATABASE_URL) throw new Error('DATABASE_URL is required');
const describeDb = DATABASE_URL ? describe : describe.skip;
describeDb('outbound preparation', () => {
  const { db, sql } = makeDb(DATABASE_URL!);
  afterAll(() => sql.end());
  async function unstarted(tx: DbTx) {
    const f = await seedPickableShipment(tx, 3);
    const graph = assembleOutbound(tx);
    const actor = { id: f.actorId, roles: ['logistics_worker'] };
    return { f, ...graph, actor };
  }
  async function noExecution(tx: DbTx, f: Awaited<ReturnType<typeof seedPickableShipment>>) {
    expect(
      await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId)),
    ).toHaveLength(0);
    expect(
      await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId)),
    ).toHaveLength(0);
    const [work] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId));
    expect(work).toMatchObject({ status: 'queued', pickerId: null });
    const pending = await tx
      .select()
      .from(wmsTables.fulfillmentCommandRequests)
      .where(eq(wmsTables.fulfillmentCommandRequests.status, 'pending'));
    expect(pending).toHaveLength(0);
  }
  it('moves the entire source and starts from the new location', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, actor } = await unstarted(tx);
      const [destination] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouseId, code: randomUUID(), locationType: 'zone' })
        .returning();
      await wireLogistics(ambientDbService(tx)).command.moveInternal(
        {
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          fromLocationId: f.locationId,
          toLocationId: destination.id,
          quantity: 3,
          idempotencyKey: randomUUID(),
        },
        tx,
      );
      await startBatchFor(tx, f);
      const result = await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
      expect(result).toMatchObject({
        status: 'in_progress',
        sources: [{ sourceLocationId: destination.id, allocatedQty: 3 }],
      });
    });
  });
  // 지연 시작이 사라졌으므로(스펙 §6) 시작 안 된 배치에서는 어느 입구든 배치를 시작하지 않고 BATCH_NOT_STARTED 로 막힌다.
  it.each(['location-scan', 'location-force', 'simple-scan', 'simple-force'] as const)(
    'does not start the batch or write anything when %s hits an unstarted batch',
    async (entry) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, simple, actor } = await unstarted(tx);
        const stockBefore = await tx
          .select()
          .from(wmsTables.stockLedgers)
          .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        const forceInput = {
          warehouseId: f.warehouseId,
          reason: 'test',
          items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 2 }],
        };
        const result =
          entry === 'location-force'
            ? await location.force(f.shipmentId, forceInput, actor, randomUUID(), authorization, tx)
            : entry === 'simple-force'
              ? await simple.forceComplete(
                  f.shipmentId,
                  { reason: 'test', actor, idempotencyKey: randomUUID(), authorization },
                  tx,
                )
              : entry === 'simple-scan'
                ? await simple.scan(
                    f.shipmentId,
                    { barcode: f.barcode, quantity: 1, actor, idempotencyKey: randomUUID() },
                    tx,
                  )
                : await location.scan(
                    f.shipmentId,
                    { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 1 },
                    actor,
                    randomUUID(),
                    tx,
                  );
        expect(result).toMatchObject({
          outcome: 'preparation_blocked',
          reasonCode: 'BATCH_NOT_STARTED',
          recovery: 'retry_preparation',
        });
        const [batch] = await tx
          .select()
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, f.batchId));
        expect(batch.startedAt).toBeNull();
        expect(await tx.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId))).toEqual(
          stockBefore,
        );
        await noExecution(tx, f);
        const [line] = await tx
          .select()
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, f.shipmentLineId));
        expect(line.inspectedQty).toBe(0);
      });
    },
  );
  it('resolves saved preparation rejection as force not applied without replacing the snapshot', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, actor } = await unstarted(tx);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 0, version: 2 })
        .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      const input = {
        warehouseId: f.warehouseId,
        reason: 'force',
        items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 3 }],
      };
      const key = randomUUID();
      const blocked = await location.force(f.shipmentId, input, actor, key, authorization, tx);
      expect(isPreparationBlocked(blocked)).toBe(true);
      expect(await location.resolveForce(f.shipmentId, input, actor, key, tx)).toEqual({
        outcome: 'rejected',
        code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
      });
      const [saved] = await tx
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key));
      expect(saved.responseSnapshot).toEqual(blocked);
      await noExecution(tx, f);
    });
  });
  it('does not turn missing force authorization into a durable preparation rejection', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, simple, actor } = await unstarted(tx);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 0, version: 2 })
        .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      await expect(
        simple.forceComplete(
          f.shipmentId,
          { reason: 'test', actor, idempotencyKey: randomUUID(), authorization: undefined },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_DISPATCH_FORCE_FORBIDDEN' } });
      await noExecution(tx, f);
    });
  });

  it('does not resume a recovery-required session or change its claim', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, actor } = await unstarted(tx);
      await startBatchFor(tx, f);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'requires manual recovery' })
        .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
      const before = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId));
      expect(await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx)).toMatchObject(
        { outcome: 'preparation_blocked', reasonCode: 'ACTIVE_WORK_REQUIRES_REVIEW' },
      );
      expect(
        await tx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId)),
      ).toEqual(before);
    });
  });
});
