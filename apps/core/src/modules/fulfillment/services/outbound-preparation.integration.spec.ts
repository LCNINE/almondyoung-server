import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, sql as sqlQuery } from 'drizzle-orm';
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
  it('replaces a stale untouched draft and starts one session', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 3);
      const { picking, location } = assembleOutbound(tx);
      const original = await picking.plan(
        { batchId: f.batchId, shipmentIds: [f.shipmentId], actorId: f.actorId, idempotencyKey: randomUUID() },
        tx,
      );
      expect(original.state).toBe('planned');
      await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
        skuId: f.skuId,
        warehouseId: f.warehouseId,
        locationId: f.locationId,
        quantity: 1,
      });
      const result = await location.start(
        f.shipmentId,
        { warehouseId: f.warehouseId },
        { id: f.actorId, roles: ['logistics_worker'] },
        randomUUID(),
        tx,
      );
      expect(result).toMatchObject({ shipmentId: f.shipmentId, status: 'in_progress' });
      const plans = await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId));
      expect(plans.map((p) => p.status).sort()).toEqual(['active', 'invalidated']);
      const sessions = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
      expect(sessions).toHaveLength(1);
    });
  });

  async function draft(tx: DbTx) {
    const f = await seedPickableShipment(tx, 3);
    const graph = assembleOutbound(tx);
    const actor = { id: f.actorId, roles: ['logistics_worker'] };
    const plan = await graph.picking.plan(
      { batchId: f.batchId, shipmentIds: [f.shipmentId], actorId: f.actorId, idempotencyKey: randomUUID() },
      tx,
    );
    return { f, ...graph, actor, plan };
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
  it.each([false, true])(
    'commits shortage marker without partial plan/session or nested pending (existing draft=%s)',
    async (existing) => {
      await inRollbackTx(db, async (tx) => {
        const f = await seedPickableShipment(tx, 3);
        const { picking, location } = assembleOutbound(tx);
        const actor = { id: f.actorId, roles: ['logistics_worker'] };
        if (existing)
          await picking.plan(
            { batchId: f.batchId, shipmentIds: [f.shipmentId], actorId: f.actorId, idempotencyKey: randomUUID() },
            tx,
          );
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
        const plans = await tx
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
        expect(plans.map((p) => p.status)).toEqual(existing ? ['invalidated'] : []);
        await noExecution(tx, f);
        await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          locationId: f.locationId,
          quantity: 4,
        });
        expect(await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx)).toEqual(result);
        await expect(location.start(f.shipmentId, { warehouseId: randomUUID() }, actor, key, tx)).rejects.toMatchObject(
          { response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' } },
        );
        await expect(
          location.start(f.shipmentId, { warehouseId: f.warehouseId }, { ...actor, id: randomUUID() }, key, tx),
        ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' } });
        await noExecution(tx, f);
        expect(
          await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
        ).toMatchObject({ status: 'in_progress' });
      });
    },
  );
  it('moves the entire source and starts from the new location', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, actor } = await draft(tx);
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
      const plans = await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId));
      expect(plans.map((p) => p.status).sort()).toEqual(['active', 'invalidated']);
    });
  });
  it.each(['manifest', 'reservation', 'waybill', 'member'] as const)(
    'does not replace changed %s identity',
    async (change) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, actor } = await draft(tx);
        if (change === 'manifest') {
          await tx
            .update(wmsTables.shipments)
            .set({ manifestVersion: 2 })
            .where(eq(wmsTables.shipments.id, f.shipmentId));
          await tx.update(wmsTables.waybills).set({ manifestVersion: 2 }).where(eq(wmsTables.waybills.id, f.waybillId));
        }
        if (change === 'reservation')
          await tx
            .update(wmsTables.shipments)
            .set({ reservationVersion: 2 })
            .where(eq(wmsTables.shipments.id, f.shipmentId));
        if (change === 'waybill')
          await tx
            .update(wmsTables.waybills)
            .set({ status: 'voided', voidedAt: new Date() })
            .where(eq(wmsTables.waybills.id, f.waybillId));
        if (change === 'member') {
          const other = await seedPickableShipment(tx, 1);
          await tx
            .update(wmsTables.outboundBatchWorkItems)
            .set({ batchId: f.batchId })
            .where(eq(wmsTables.outboundBatchWorkItems.id, other.workItemId));
        }
        const result = await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
        expect(result).toMatchObject({ outcome: 'preparation_blocked', recovery: 'review_batch' });
        const plans = await tx
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
        expect(plans.map((p) => p.status)).toEqual(['invalidated']);
        await noExecution(tx, f);
      });
    },
  );
  it.each(['active', 'history'] as const)(
    'preserves inconsistent draft with %s execution evidence',
    async (evidence) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, actor } = await draft(tx);
        await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
        await tx
          .update(wmsTables.pickingPlans)
          .set({ status: 'draft' })
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
        if (evidence === 'history') {
          await tx
            .update(wmsTables.batchInventorySessionBalances)
            .set({ qty: 0 })
            .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId));
          await tx
            .update(wmsTables.outboundBatchWorkItems)
            .set({ status: 'queued', pickerId: null, pickerClaimedAt: null })
            .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId));
        }
        const before = await tx.select().from(wmsTables.batchInventorySessionEvents);
        expect(
          await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
        ).toMatchObject({ outcome: 'preparation_blocked', reasonCode: 'ACTIVE_WORK_REQUIRES_REVIEW' });
        expect(await tx.select().from(wmsTables.batchInventorySessionEvents)).toEqual(before);
        expect(
          await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId)),
        ).toHaveLength(1);
      });
    },
  );
  it.each(['location-barcode', 'location-over', 'force', 'simple-barcode', 'simple-over'] as const)(
    'rolls back stale replacement and all nested commands after %s failure in an ambient transaction',
    async (failure) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, simple, actor } = await draft(tx);
        await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          locationId: f.locationId,
          quantity: 1,
        });
        const plansBefore = await tx
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
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
        expect(
          await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId)),
        ).toEqual(plansBefore);
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
      const { f, location, actor } = await draft(tx);
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
      const { f, simple, actor } = await draft(tx);
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
      const plans = await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId));
      expect(plans.map((p) => p.status)).toEqual(['draft']);
      await noExecution(tx, f);
    });
  });

  it('rolls back a second stale replacement and terminates without a third plan', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, location, picking, actor } = await draft(tx);
      await tx.update(wmsTables.stockLedgers).set({ version: 2 }).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      const original = picking.start.bind(picking);
      let starts = 0;
      const spy = jest.spyOn(picking, 'start').mockImplementation(async (input, trx) => {
        if (++starts === 2)
          await trx!
            .update(wmsTables.stockLedgers)
            .set({ version: 3 })
            .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        return original(input, trx);
      });
      try {
        expect(
          await location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
        ).toMatchObject({ outcome: 'preparation_blocked', reasonCode: 'REPLAN_LIMIT_REACHED' });
        expect(starts).toBe(2);
        const plans = await tx
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
        expect(plans.map((p) => p.status)).toEqual(['invalidated']);
        const [ledger] = await tx
          .select()
          .from(wmsTables.stockLedgers)
          .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        expect(ledger.version).toBe(2);
        await noExecution(tx, f);
      } finally {
        spy.mockRestore();
      }
    });
  });
  it.each(['unexpected', 'permission', 'database'] as const)(
    'propagates %s replacement failures and rolls back the original invalidation',
    async (kind) => {
      await inRollbackTx(db, async (tx) => {
        const { f, location, picking, actor } = await draft(tx);
        await tx.update(wmsTables.stockLedgers).set({ version: 2 }).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        const before = await tx.select().from(wmsTables.fulfillmentCommandRequests);
        const spy = jest.spyOn(picking, 'plan').mockImplementation(async (_input, trx) => {
          if (kind === 'database') await trx!.execute(sqlQuery`select 1/0`);
          if (kind === 'permission') throw new ForbiddenException('test authorization denied');
          throw new Error('test unknown failure');
        });
        try {
          await expect(
            location.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
          ).rejects.toBeDefined();
          expect(
            (await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId))).map(
              (p) => p.status,
            ),
          ).toEqual(['draft']);
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
      const { f, location, actor } = await draft(tx);
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
