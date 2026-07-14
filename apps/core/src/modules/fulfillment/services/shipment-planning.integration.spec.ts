import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from './__support__';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const COMPLETE_RECIPIENT = {
  recipientName: 'Integration Tester',
  phone: '010-0000-0000',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

describeIfDb('ShipmentPlanningService (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let planning: ShipmentPlanningService;
  const actor = { id: randomUUID(), roles: ['master'] };

  function makePlanningService(dbService: ReturnType<typeof makeDbService>, logistics: Wired): ShipmentPlanningService {
    return new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      logistics.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    planning = makePlanningService(dbService, wired);
  });

  afterAll(async () => {
    await client.end();
  });

  async function physicalFixture(tx: DbTx, quantity: number, onHand: number) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    if (onHand > 0) {
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: onHand,
      });
    }
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: COMPLETE_RECIPIENT })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    const { matchingId } = await seedMatching(tx, { variantId, skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .then((rows) => rows.map((row) => row.fulfillment_order_items));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
    return {
      warehouseId,
      locationId,
      holderId,
      skuId,
      matchingId,
      salesOrderId,
      salesOrderLineId: lineIds[0],
      item,
      line,
      shipment,
    };
  }

  async function seedActiveWorkItem(tx: DbTx, warehouseId: string, shipmentId: string, waitingOperationId?: string) {
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `planning-test-${randomUUID()}`,
        warehouseId,
        pickingMethod: 'individual',
      })
      .returning();
    const [workItem] = await tx
      .insert(wmsTables.outboundBatchWorkItems)
      .values({ batchId: batch.id, shipmentId, waitingOperationId })
      .returning();
    return workItem;
  }

  it('splits 10 into 6/4 unreserved-first, replays, and rejects a changed request for the same key', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      const key = `split-${randomUUID()}`;
      const request = {
        expectedManifestVersion: fixture.shipment.manifestVersion,
        reason: 'separate backorder',
        moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
      };

      const first = await planning.split(fixture.shipment.id, request, key, actor, tx);
      expect(first.source.lines).toEqual([expect.objectContaining({ id: fixture.line.id, qty: 6, reservedQty: 6 })]);
      expect(first.target.lines).toEqual([expect.objectContaining({ qty: 4, reservedQty: 0 })]);

      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(item).toMatchObject({ qty: 10, canceledQty: 0 });
      expect((await planning.split(fixture.shipment.id, request, key, actor, tx)).target.shipmentId).toBe(
        first.target.shipmentId,
      );
      let mismatch: unknown;
      try {
        await planning.split(fixture.shipment.id, { ...request, reason: 'different request' }, key, actor, tx);
      } catch (error) {
        mismatch = error;
      }
      expect(mismatch).toBeInstanceOf(ConflictException);
      expect((mismatch as ConflictException).getResponse()).toMatchObject({
        code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH',
      });

      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, first.operationId));
      expect(operation.idempotencyKey).toBe(key);
    });
  });

  it('cancels an unreserved remainder before releasing confirmed reservations', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 10, 6);
      await planning.cancelOutstanding(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'cancel backorder only',
          lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
        },
        `cancel-${randomUUID()}`,
        actor,
        tx,
      );

      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(line).toMatchObject({ qty: 6, reservedQty: 6 });
      expect(reservation).toMatchObject({ quantity: 6, status: 'confirmed' });
      expect(item).toMatchObject({ qty: 10, canceledQty: 4, reservedQty: 6 });
    });
  });

  it('stores a durable cancellation intent when a Planned shipment must reopen', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 3, 3);
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const key = `pending-cancel-${randomUUID()}`;
      const result = await planning.cancelOutstanding(
        fixture.shipment.id,
        {
          expectedManifestVersion: fixture.shipment.manifestVersion,
          reason: 'change plan first',
          lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
        },
        key,
        actor,
        tx,
      );

      expect(result.operationStatus).toBe('pending');
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      const [member] = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, result.operationId));
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [waitingWorkItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      expect(operation).toMatchObject({ status: 'pending', idempotencyKey: key });
      expect(operation.afterManifestSnapshot).toMatchObject({
        pendingIntent: {
          kind: 'cancel_outstanding',
          lines: [{ shipmentLineId: fixture.line.id, qty: 1 }],
        },
      });
      expect(member.afterManifestSnapshot).toEqual(operation.afterManifestSnapshot);
      expect(waitingWorkItem.waitingOperationId).toBe(result.operationId);
      expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      expect(shipment.manifestVersion).toBe(fixture.shipment.manifestVersion);
    });
  });

  it('rejects replacing a work item waiting operation and rolls the new cancellation back', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 3, 3);
      const existingOperationId = randomUUID();
      await tx.insert(wmsTables.shipmentOperations).values({
        id: existingOperationId,
        type: 'consolidate',
        status: 'pending',
        operatorId: actor.id,
        reason: 'existing recovery prerequisite',
        idempotencyKey: `existing-wait-${randomUUID()}`,
        requestHash: '0'.repeat(64),
      });
      const workItem = await seedActiveWorkItem(tx, fixture.warehouseId, fixture.shipment.id, existingOperationId);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const key = `conflicting-pending-cancel-${randomUUID()}`;

      let error: unknown;
      try {
        await tx.transaction((nestedTx) =>
          planning.cancelOutstanding(
            fixture.shipment.id,
            {
              expectedManifestVersion: fixture.shipment.manifestVersion,
              reason: 'must not replace existing recovery',
              lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
            },
            key,
            actor,
            nestedTx as unknown as DbTx,
          ),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANCELLATION_WORK_ITEM_ALREADY_WAITING',
      });
      const [unchangedWorkItem] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, workItem.id));
      const [unchangedShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [rolledBackCommand] = await tx
        .select({ id: wmsTables.fulfillmentCommandRequests.id })
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key));
      expect(unchangedWorkItem.waitingOperationId).toBe(existingOperationId);
      expect(unchangedShipment.status).toBe('planned');
      expect(rolledBackCommand).toBeUndefined();
    });
  });

  it('rejects dispatched shipment cancellation instead of mutating shipped quantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 2, 2);
      await wired.shipmentReservations.releasePartial(fixture.line.id, 2, 'dispatch fixture', tx);
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ shippedQty: 2 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));

      let error: unknown;
      try {
        await planning.cancelOutstanding(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'invalid shipped cancel',
            lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
          },
          `shipped-cancel-${randomUUID()}`,
          actor,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_ALREADY_DISPATCHED' });
    });
  });

  it('rejects planning a mixed-profile shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const [profileA, profileB] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values([
          { name: `profile-a-${randomUUID()}`, sourceType: 'in_house' },
          { name: `profile-b-${randomUUID()}`, sourceType: 'in_house' },
        ])
        .returning();
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const firstSku = await seedSku(tx, holderId);
      const secondSku = await seedSku(tx, holderId);
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profileA.id })
        .where(eq(wmsTables.skus.id, firstSku.skuId));
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profileB.id })
        .where(eq(wmsTables.skus.id, secondSku.skuId));
      await tx.insert(wmsTables.stockLedgers).values([
        { skuId: firstSku.skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 1 },
        { skuId: secondSku.skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 1 },
      ]);
      const variants = [randomUUID(), randomUUID()];
      const { salesOrderId } = await seedSalesOrder(tx, {
        lines: variants.map((variantId) => ({ variantId, quantity: 1 })),
      });
      await tx
        .update(wmsTables.salesOrders)
        .set({ shippingAddress: COMPLETE_RECIPIENT })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
      await seedMatching(tx, { variantId: variants[0], skuId: firstSku.skuId });
      await seedMatching(tx, { variantId: variants[1], skuId: secondSku.skuId });
      await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.warehouseId, warehouseId));

      let error: unknown;
      try {
        await planning.plan(
          shipment.id,
          {
            shippingProfileId: profileA.id,
            expectedManifestVersion: shipment.manifestVersion,
            expectedReservationVersion: shipment.reservationVersion,
          },
          `plan-${randomUUID()}`,
          actor,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code: 'SHIPMENT_PROFILE_INCOMPATIBLE' });
    });
  });

  it('rejects incomplete profile execution configuration and plans after all fields are supplied', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalFixture(tx, 1, 1);
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({
          name: `incomplete-profile-${randomUUID()}`,
          sourceType: 'in_house',
          supportedFulfillmentModes: ['in_house'],
        })
        .returning();
      await tx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: profile.id })
        .where(eq(wmsTables.skus.id, fixture.skuId));

      let error: unknown;
      try {
        await planning.plan(
          fixture.shipment.id,
          {
            shippingProfileId: profile.id,
            expectedManifestVersion: fixture.shipment.manifestVersion,
            expectedReservationVersion: fixture.shipment.reservationVersion,
          },
          `plan-incomplete-${randomUUID()}`,
          actor,
          tx,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
      });

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({
          senderSnapshot: { name: 'Sender' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'carrier-account-1',
        })
        .where(eq(wmsTables.deliveryProfiles.id, profile.id));
      const planned = await planning.plan(
        fixture.shipment.id,
        {
          shippingProfileId: profile.id,
          expectedManifestVersion: fixture.shipment.manifestVersion,
          expectedReservationVersion: fixture.shipment.reservationVersion,
        },
        `plan-complete-${randomUUID()}`,
        actor,
        tx,
      );
      expect(planned.shipment.status).toBe('planned');
    });
  });

  it('serializes a concurrent split and cancellation so exactly one stale command loses', async () => {
    const fixture = await db.transaction((tx) => physicalFixture(tx as unknown as DbTx, 10, 6));
    const splitKey = `concurrent-split-${randomUUID()}`;
    const cancelKey = `concurrent-cancel-${randomUUID()}`;
    const concurrentDb = makeDb(DATABASE_URL as string);
    const concurrentDbService = makeDbService(concurrentDb.db);
    const concurrentWired = wireLogistics(concurrentDbService, 'v2');
    const concurrentPlanning = makePlanningService(concurrentDbService, concurrentWired);

    try {
      const results = await Promise.allSettled([
        planning.split(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'concurrent split',
            moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
          },
          splitKey,
          actor,
        ),
        concurrentPlanning.cancelOutstanding(
          fixture.shipment.id,
          {
            expectedManifestVersion: fixture.shipment.manifestVersion,
            reason: 'concurrent cancellation',
            lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
          },
          cancelKey,
          actor,
        ),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

      await db.transaction(async (tx) => {
        await new FulfillmentInvariantService().assertFulfillmentOrders(
          [fixture.item.fulfillmentOrderId],
          tx as unknown as DbTx,
        );
      });
      const [item] = await db
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      expect(item.qty).toBe(10);
      expect(item.canceledQty === 0 || item.canceledQty === 4).toBe(true);
    } finally {
      await concurrentDb.sql.end();
      await db.transaction(async (tx) => {
        const shipmentRows = await tx
          .select({ id: wmsTables.shipments.id })
          .from(wmsTables.shipments)
          .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
          .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fixture.item.id));
        const shipmentIds = shipmentRows.map((row) => row.id);
        const operationRows = shipmentIds.length
          ? await tx
              .select({ id: wmsTables.shipmentOperationMembers.operationId })
              .from(wmsTables.shipmentOperationMembers)
              .where(inArray(wmsTables.shipmentOperationMembers.shipmentId, shipmentIds))
          : [];
        const operationIds = [...new Set(operationRows.map((row) => row.id))];
        await tx
          .delete(wmsTables.fulfillmentCommandRequests)
          .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [splitKey, cancelKey]));
        if (operationIds.length) {
          await tx
            .delete(wmsTables.shipmentOperationMembers)
            .where(inArray(wmsTables.shipmentOperationMembers.operationId, operationIds));
          await tx.delete(wmsTables.shipmentOperations).where(inArray(wmsTables.shipmentOperations.id, operationIds));
        }
        if (shipmentIds.length) {
          const lineRows = await tx
            .select({ id: wmsTables.shipmentLines.id })
            .from(wmsTables.shipmentLines)
            .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
          const lineIds = lineRows.map((row) => row.id);
          if (lineIds.length) {
            await tx
              .delete(wmsTables.stockReservations)
              .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds));
            await tx.delete(wmsTables.shipmentLines).where(inArray(wmsTables.shipmentLines.id, lineIds));
          }
          await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, shipmentIds));
        }
        await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fixture.salesOrderId));
        await tx
          .delete(wmsTables.productVariantSkuLinks)
          .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, fixture.matchingId));
        await tx.delete(wmsTables.productMatchings).where(eq(wmsTables.productMatchings.id, fixture.matchingId));
        await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.skuId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.skuId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holderId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, fixture.locationId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouseId));
      });
    }
  });
});
