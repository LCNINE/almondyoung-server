import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, sql as sqlQuery } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment, receiveStock, wireLogistics } from './__support__';
import { assembleOutbound, ambientDbService } from './__support__/simple-outbound-wiring';

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
  it('commits shortage marker without partial allocation/session or nested pending', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 3);
      const { location } = assembleOutbound(tx);
      const actor = { id: f.actorId, roles: ['logistics_worker'] };
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 0, version: 2 })
        .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      const key = randomUUID();
      const result = await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx);
      expect(result).toMatchObject({
        outcome: 'preparation_blocked',
        reasonCode: 'SOURCE_INSUFFICIENT',
        recovery: 'retry_preparation',
      });
      expect(
        await tx
          .select()
          .from(wmsTables.pickingSourceAllocations)
          .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId)),
      ).toHaveLength(0);
      await noExecution(tx, f);
      await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
        skuId: f.skuId,
        warehouseId: f.warehouseId,
        locationId: f.locationId,
        quantity: 4,
      });
      expect(await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx)).toEqual(result);
      await expect(location.start(f.shipmentId, { warehouseId: randomUUID() }, actor, key, tx)).rejects.toMatchObject({
        response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' },
      });
      await expect(
        location.start(f.shipmentId, { warehouseId: f.warehouseId }, { ...actor, id: randomUUID() }, key, tx),
      ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' } });
      await noExecution(tx, f);
      expect(await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx)).toMatchObject(
        { status: 'in_progress' },
      );
    });
  });
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
      const result = await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
      expect(result).toMatchObject({
        status: 'in_progress',
        sources: [{ sourceLocationId: destination.id, allocatedQty: 3 }],
      });
    });
  });
  it.each(['location-barcode', 'location-over', 'force', 'simple-barcode', 'simple-over'] as const)(
    'rolls back batch start and all nested commands after %s failure in an ambient transaction',
    async (failure) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, simple, actor } = await unstarted(tx);
        await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          locationId: f.locationId,
          quantity: 1,
        });
        const stockBefore = await tx
          .select()
          .from(wmsTables.stockLedgers)
          .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        const commandsBefore = await tx.select().from(wmsTables.fulfillmentCommandRequests);
        const call =
          failure === 'force'
            ? location.force(
                f.shipmentId,
                {
                  warehouseId: f.warehouseId,
                  reason: 'test',
                  items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 2 }],
                },
                actor,
                randomUUID(),
                authorization,
                tx,
              )
            : failure.startsWith('simple')
              ? simple.scan(
                  f.shipmentId,
                  {
                    barcode: failure.endsWith('barcode') ? randomUUID() : f.barcode,
                    quantity: failure.endsWith('over') ? 4 : 1,
                    actor,
                    idempotencyKey: randomUUID(),
                  },
                  tx,
                )
              : location.scan(
                  f.shipmentId,
                  {
                    warehouseId: f.warehouseId,
                    sourceLocationId: f.locationId,
                    barcode: failure.endsWith('barcode') ? randomUUID() : f.barcode,
                    quantity: failure.endsWith('over') ? 4 : 1,
                  },
                  actor,
                  randomUUID(),
                  tx,
                );
        await expect(call).rejects.toBeDefined();
        const [batch] = await tx
          .select()
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, f.batchId));
        expect(batch.startedAt).toBeNull();
        expect(await tx.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId))).toEqual(
          stockBefore,
        );
        expect(await tx.select().from(wmsTables.fulfillmentCommandRequests)).toEqual(commandsBefore);
        await noExecution(tx, f);
        const [line] = await tx
          .select()
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, f.shipmentLineId));
        expect(line.inspectedQty).toBe(0);
        const [waybill] = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, f.waybillId));
        expect(waybill.status).toBe('registered');
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

  it.each(['unexpected', 'permission', 'database'] as const)(
    'propagates %s batch start failures without leaving nested commands',
    async (kind) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, picking, actor } = await unstarted(tx);
        await tx.update(wmsTables.stockLedgers).set({ version: 2 }).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        const before = await tx.select().from(wmsTables.fulfillmentCommandRequests);
        const spy = jest.spyOn(picking, 'start').mockImplementation(async (_input, trx) => {
          if (kind === 'database') await trx!.execute(sqlQuery`select 1/0`);
          if (kind === 'permission') throw new ForbiddenException('test authorization denied');
          throw new Error('test unknown failure');
        });
        try {
          await expect(
            location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
          ).rejects.toBeDefined();
          expect(await tx.select().from(wmsTables.fulfillmentCommandRequests)).toEqual(before);
          await noExecution(tx, f);
        } finally {
          spy.mockRestore();
        }
      });
    },
  );

  it('does not resume a recovery-required session or change its claim', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, actor } = await unstarted(tx);
      await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
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
