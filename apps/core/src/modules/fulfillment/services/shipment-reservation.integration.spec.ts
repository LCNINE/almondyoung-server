import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
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

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('V2 draft shipment partial reservation (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    wired = wireLogistics(makeDbService(db), 'v2');
  });

  afterAll(async () => {
    await client.end();
  });

  async function physicalOrder(tx: DbTx, options: { quantity: number; onHand: number; profileId?: string }) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    if (options.profileId) {
      await tx.update(wmsTables.skus).set({ deliveryProfileId: options.profileId }).where(eq(wmsTables.skus.id, skuId));
    }
    if (options.onHand > 0) {
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: options.onHand,
      });
    }
    const variantId = randomUUID();
    const { salesOrderId } = await seedSalesOrder(tx, {
      lines: [{ variantId, quantity: options.quantity }],
    });
    await seedMatching(tx, { variantId, skuId });
    return { warehouseId, locationId, holderId, skuId, salesOrderId };
  }

  async function loadV2(tx: DbTx, salesOrderId: string) {
    const [fo] = await tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    const [line] = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        reservedQty: wmsTables.shipmentLines.reservedQty,
        createdAt: wmsTables.shipmentLines.createdAt,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
    return { fo, line, shipment };
  }

  it('creates one Draft with all lines and reserves 6/10, then grows the same claim by a +2 retry', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 10, onHand: 6 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const first = await loadV2(tx, fixture.salesOrderId);
      expect(first.fo).toMatchObject({ status: 'partially_reserved', totalReservedQty: 6 });
      expect(first.shipment).toMatchObject({
        status: 'draft',
        openedForFulfillmentOrderId: null,
        reservationVersion: 2,
      });
      expect(first.line.reservedQty).toBe(6);

      const firstReservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, first.line.id));
      expect(firstReservations).toHaveLength(1);
      expect(firstReservations[0]).toMatchObject({
        targetType: 'SHIPMENT_LINE',
        targetId: first.line.id,
        fulfillmentOrderItemId: null,
        quantity: 6,
        status: 'confirmed',
      });
      expect(firstReservations[0].requestedAt?.getTime()).toBe(first.line.createdAt.getTime());

      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 8 })
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.skuId),
            eq(wmsTables.stockLedgers.warehouseId, fixture.warehouseId),
          ),
        );
      expect((await wired.retryWorker.findCandidates(20, tx)).map((row) => row.id)).toContain(first.line.id);
      await wired.retryWorker.retryOne(first.line.id, tx);

      const [after] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, first.line.id));
      expect(after.quantity).toBe(8);
      expect(after.requestedAt?.getTime()).toBe(first.line.createdAt.getTime());
      expect((await loadV2(tx, fixture.salesOrderId)).shipment.reservationVersion).toBe(3);
    });
  });

  it('is idempotent for a duplicate order event and never creates a second Draft', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 2, onHand: 2 });
      const first = await wired.fulfillments.create(
        { salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId },
        tx,
      );
      const duplicate = await wired.fulfillments.create(
        { salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId },
        tx,
      );
      expect(duplicate?.id).toBe(first?.id);
      const [fo] = await tx
        .select({ id: wmsTables.fulfillmentOrders.id })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, fixture.salesOrderId));
      const lines = await tx
        .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
        .from(wmsTables.shipmentLines)
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
      expect(new Set(lines.map((line) => line.shipmentId)).size).toBe(1);
    });
  });

  it('rejects physical V2 demand without a warehouse before creating an FO', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 1, onHand: 1 });
      try {
        await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId }, tx);
        throw new Error('expected V2 warehouse preflight to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'V2_PHYSICAL_FULFILLMENT_REQUIRES_WAREHOUSE',
        });
      }
      const rows = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, fixture.salesOrderId));
      expect(rows).toHaveLength(0);
    });
  });

  it('keeps digital-only orders on the no-FO route', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId } = await seedWarehouseWithZone(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ fulfillmentKind: 'digital', requiresShipping: false })
        .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
      await expect(wired.fulfillments.create({ salesOrderId, warehouseId }, tx)).resolves.toBeNull();
      await expect(wired.fulfillments.create({ salesOrderId, fulfillmentMode: 'drop_ship' }, tx)).resolves.toBeNull();
      expect(
        await tx
          .select()
          .from(wmsTables.fulfillmentOrders)
          .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId)),
      ).toHaveLength(0);
    });
  });

  it('keeps drop_ship on the direct route without a shipment or own-stock reservation', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 2, onHand: 2 });
      const fo = await wired.fulfillments.create(
        { salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId, fulfillmentMode: 'drop_ship' },
        tx,
      );
      expect(fo).toMatchObject({ fulfillmentMode: 'drop_ship', status: 'ready' });
      expect(await tx.select().from(wmsTables.shipments)).toHaveLength(0);
      expect(await tx.select().from(wmsTables.stockReservations)).toHaveLength(0);
    });
  });

  it('routes drop_shipped SKU demand directly even when backlog input omits fulfillmentMode', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 2, onHand: 0 });
      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, fixture.skuId));

      const fo = await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId }, tx);
      expect(fo).toMatchObject({ fulfillmentMode: 'drop_ship', warehouseId: null, status: 'ready' });
      expect(await tx.select().from(wmsTables.shipments)).toHaveLength(0);
      expect(await tx.select().from(wmsTables.stockReservations)).toHaveLength(0);
    });
  });

  it('keeps a mixed-profile initial shipment Draft with no selected profile', async () => {
    await inRollbackTx(db, async (tx) => {
      const [profileA, profileB] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values([
          { name: `profile-a-${randomUUID()}`, sourceType: 'in_house' },
          { name: `profile-b-${randomUUID()}`, sourceType: 'in_house' },
        ])
        .returning();
      const { warehouseId } = await seedWarehouseWithZone(tx);
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
      const firstVariant = randomUUID();
      const secondVariant = randomUUID();
      const { salesOrderId } = await seedSalesOrder(tx, {
        lines: [
          { variantId: firstVariant, quantity: 1 },
          { variantId: secondVariant, quantity: 1 },
        ],
      });
      await seedMatching(tx, { variantId: firstVariant, skuId: firstSku.skuId });
      await seedMatching(tx, { variantId: secondVariant, skuId: secondSku.skuId });

      await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
      const loaded = await loadV2(tx, salesOrderId);
      expect(loaded.shipment).toMatchObject({ status: 'draft', shippingProfileId: null });
    });
  });

  it('does not mutate rows or reservationVersion when a partial reserve has zero available stock', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 3, onHand: 0 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const loaded = await loadV2(tx, fixture.salesOrderId);
      expect(loaded.shipment.reservationVersion).toBe(1);

      const result = await wired.shipmentReservations.reservePartial(loaded.line.id, 3, tx);
      expect(result).toMatchObject({ mutated: false, reservedQty: 0, reservationVersion: 1 });
      expect(
        await tx
          .select()
          .from(wmsTables.stockReservations)
          .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id)),
      ).toHaveLength(0);
      expect((await loadV2(tx, fixture.salesOrderId)).shipment.reservationVersion).toBe(1);
    });
  });

  it('splits rows only for partial release and preserves requestedAt through a full release', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 10, onHand: 10 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const loaded = await loadV2(tx, fixture.salesOrderId);
      const [original] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));

      const partial = await wired.shipmentReservations.releasePartial(loaded.line.id, 3, 'split cancellation', tx);
      expect(partial).toMatchObject({ releasedQty: 3, totalReservedQty: 7, reservationVersion: 3 });
      const afterPartial = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));
      expect(afterPartial).toHaveLength(2);
      expect(afterPartial.find((row) => row.status === 'confirmed')).toMatchObject({ id: original.id, quantity: 7 });
      expect(afterPartial.find((row) => row.status === 'released')).toMatchObject({
        quantity: 3,
        stateReason: 'split cancellation',
      });
      expect(afterPartial.every((row) => row.requestedAt?.getTime() === original.requestedAt?.getTime())).toBe(true);

      const full = await wired.shipmentReservations.releasePartial(loaded.line.id, 7, 'cancel remainder', tx);
      expect(full).toMatchObject({ releasedQty: 7, totalReservedQty: 0, reservationVersion: 4 });
      const finalRows = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));
      expect(finalRows).toHaveLength(2);
      expect(finalRows.every((row) => row.status === 'released')).toBe(true);
    });
  });

  it('invalidates only oldest short-pick quantity, preserves good fairness, and replays the exact operation', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 10, onHand: 10 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const loaded = await loadV2(tx, fixture.salesOrderId);
      const [original] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));
      const newerRequestedAt = new Date((original.requestedAt ?? original.createdAt).getTime() + 60_000);
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 6 })
        .where(eq(wmsTables.stockReservations.id, original.id));
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'SHIPMENT_LINE',
        targetId: loaded.line.id,
        shipmentLineId: loaded.line.id,
        skuId: fixture.skuId,
        warehouseId: fixture.warehouseId,
        quantity: 4,
        status: 'confirmed',
        requestedAt: newerRequestedAt,
        reason: 'newer good claim',
      });
      const operationId = randomUUID();
      const operationActorId = randomUUID();
      const [operation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          id: operationId,
          type: 'short_pick',
          operatorId: operationActorId,
          reason: 'confirmed physical shortage',
          idempotencyKey: `reservation-short-${randomUUID()}`,
          requestHash: 'a'.repeat(64),
          beforeManifestSnapshot: {
            intent: {
              kind: 'short_pick',
              operationId,
              shipmentId: loaded.shipment.id,
              sessionId: randomUUID(),
              actorId: operationActorId,
              reason: 'confirmed physical shortage',
              lines: [
                {
                  shipmentLineId: loaded.line.id,
                  sourceLocationId: fixture.locationId,
                  shortQty: 7,
                  allocationQty: 10,
                },
              ],
            },
          },
        })
        .returning();
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId: operation.id,
        shipmentId: loaded.shipment.id,
        role: 'source',
      });

      const invalidated = await wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 7, operation.id, tx);
      expect(invalidated).toMatchObject({
        invalidatedQty: 7,
        totalReservedQty: 3,
        replayed: false,
      });
      const rows = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));
      const good = rows.filter((row) => row.status === 'confirmed');
      const bad = rows.filter((row) => row.stateReason === `short-pick:${operation.id}`);
      expect(good).toHaveLength(1);
      expect(good[0]).toMatchObject({ quantity: 3, requestedAt: newerRequestedAt });
      expect(bad.reduce((total, row) => total + row.quantity, 0)).toBe(7);
      expect(bad.every((row) => row.status === 'released' && row.invalidatedAt !== null)).toBe(true);

      const replay = await wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 7, operation.id, tx);
      expect(replay).toMatchObject({ replayed: true, invalidatedQty: 7, totalReservedQty: 3 });
      const versionAfterReplay = (await loadV2(tx, fixture.salesOrderId)).shipment.reservationVersion;
      expect(versionAfterReplay).toBe(invalidated.reservationVersion);
      await expect(
        wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 8, operation.id, tx),
      ).rejects.toThrow('differs from immutable short-pick intent 7');
      await tx
        .update(wmsTables.shipmentOperations)
        .set({ status: 'recovery_required', lastError: 'invoice void retry pending' })
        .where(eq(wmsTables.shipmentOperations.id, operation.id));
      await expect(
        wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 7, operation.id, tx),
      ).resolves.toMatchObject({ replayed: true, invalidatedQty: 7 });

      await tx
        .update(wmsTables.shipmentOperations)
        .set({ status: 'completed', lastError: null, completedAt: new Date() })
        .where(eq(wmsTables.shipmentOperations.id, operation.id));
      await expect(
        wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 7, operation.id, tx),
      ).resolves.toMatchObject({ replayed: true, invalidatedQty: 7 });
      const [unintendedItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: loaded.fo.id, skuId: fixture.skuId, qty: 1 })
        .returning();
      const [unintendedLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: loaded.shipment.id,
          fulfillmentOrderItemId: unintendedItem.id,
          skuId: fixture.skuId,
          qty: 1,
        })
        .returning();
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'SHIPMENT_LINE',
        targetId: unintendedLine.id,
        shipmentLineId: unintendedLine.id,
        skuId: fixture.skuId,
        warehouseId: fixture.warehouseId,
        quantity: 1,
        status: 'confirmed',
        requestedAt: unintendedLine.createdAt,
      });
      await expect(
        wired.shipmentReservations.invalidateForShortPick(unintendedLine.id, 1, operation.id, tx),
      ).rejects.toThrow('differs from immutable short-pick intent 0');

      const [wrongOperation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          type: 'replan',
          operatorId: randomUUID(),
          reason: 'wrong operation type',
          idempotencyKey: `reservation-wrong-${randomUUID()}`,
          requestHash: 'b'.repeat(64),
        })
        .returning();
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId: wrongOperation.id,
        shipmentId: loaded.shipment.id,
        role: 'source',
      });
      await expect(
        wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 1, wrongOperation.id, tx),
      ).rejects.toThrow('requires an exact short-pick operation intent');

      const overOperationId = randomUUID();
      const overActorId = randomUUID();
      const [overOperation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          id: overOperationId,
          type: 'short_pick',
          operatorId: overActorId,
          reason: 'over shortage',
          idempotencyKey: `reservation-over-${randomUUID()}`,
          requestHash: 'c'.repeat(64),
          beforeManifestSnapshot: {
            intent: {
              kind: 'short_pick',
              operationId: overOperationId,
              shipmentId: loaded.shipment.id,
              sessionId: randomUUID(),
              actorId: overActorId,
              reason: 'over shortage',
              lines: [
                {
                  shipmentLineId: loaded.line.id,
                  sourceLocationId: fixture.locationId,
                  shortQty: 4,
                  allocationQty: 10,
                },
              ],
            },
          },
        })
        .returning();
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId: overOperation.id,
        shipmentId: loaded.shipment.id,
        role: 'source',
      });
      await expect(
        wired.shipmentReservations.invalidateForShortPick(loaded.line.id, 4, overOperation.id, tx),
      ).rejects.toThrow('has 3 confirmed');

      await wired.shipmentReservations.reservePartial(loaded.line.id, 1, tx);
      const [retried] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(retried.quantity).toBe(4);
      expect(retried.requestedAt?.getTime()).toBe((original.requestedAt ?? original.createdAt).getTime());
    });
  });

  it('transfers a partial claim to an existing compatible Draft line with quantity/time/version conservation', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 10, onHand: 10 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const loaded = await loadV2(tx, fixture.salesOrderId);
      const [sourceItem] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, loaded.fo.id));
      const [original] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, loaded.line.id));

      // Task 10 split updates line summaries before moving the reservation rows;
      // the command transaction is validated after transfer/recompute.
      await tx
        .update(wmsTables.shipmentLines)
        .set({ qty: 6, reservedQty: 6 })
        .where(eq(wmsTables.shipmentLines.id, loaded.line.id));
      const [targetShipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: fixture.warehouseId, status: 'draft' })
        .returning();
      const [targetLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: targetShipment.id,
          fulfillmentOrderItemId: sourceItem.id,
          skuId: fixture.skuId,
          qty: 4,
        })
        .returning();

      const transferred = await wired.shipmentReservations.transfer(loaded.line.id, targetLine.id, 4, tx);
      expect(transferred).toMatchObject({
        transferredQty: 4,
        sourceReservationVersion: 3,
        targetReservationVersion: 2,
      });
      const rows = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.status, 'confirmed'));
      const source = rows.find((row) => row.shipmentLineId === loaded.line.id);
      const target = rows.find((row) => row.shipmentLineId === targetLine.id);
      expect(source).toMatchObject({ id: original.id, quantity: 6 });
      expect(target).toMatchObject({ quantity: 4, targetType: 'SHIPMENT_LINE', targetId: targetLine.id });
      expect(target?.requestedAt?.getTime()).toBe(original.requestedAt?.getTime());
      expect((source?.quantity ?? 0) + (target?.quantity ?? 0)).toBe(10);
    });
  });

  it('rejects reservation mutation on non-Draft shipments and cross-SKU transfer', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await physicalOrder(tx, { quantity: 2, onHand: 2 });
      await wired.fulfillments.create({ salesOrderId: fixture.salesOrderId, warehouseId: fixture.warehouseId }, tx);
      const loaded = await loadV2(tx, fixture.salesOrderId);
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, loaded.shipment.id));
      await expect(wired.shipmentReservations.reservePartial(loaded.line.id, 1, tx)).rejects.toThrow(
        /planned shipment/,
      );
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'draft' })
        .where(eq(wmsTables.shipments.id, loaded.shipment.id));

      const { holderId } = await seedHolder(tx);
      const otherSku = await seedSku(tx, holderId);
      const [otherFo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ warehouseId: fixture.warehouseId, totalItems: 1, totalQty: 1 })
        .returning();
      const [otherItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: otherFo.id, skuId: otherSku.skuId, qty: 1 })
        .returning();
      const [otherShipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: fixture.warehouseId, status: 'draft' })
        .returning();
      const [otherLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: otherShipment.id,
          fulfillmentOrderItemId: otherItem.id,
          skuId: otherSku.skuId,
          qty: 1,
        })
        .returning();
      await expect(wired.shipmentReservations.transfer(loaded.line.id, otherLine.id, 1, tx)).rejects.toThrow(
        /same SKU and warehouse/,
      );
    });
  });

  it('serializes concurrent retries so confirmed reservations never exceed the line or stock', async () => {
    const ids = await db.transaction(async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: 6,
      });
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ warehouseId, totalItems: 1, totalQty: 10 })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fo.id, skuId, qty: 10 })
        .returning();
      const [shipment] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'draft' }).returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({ shipmentId: shipment.id, fulfillmentOrderItemId: item.id, skuId, qty: 10 })
        .returning();
      return {
        warehouseId,
        locationId,
        holderId,
        skuId,
        foId: fo.id,
        itemId: item.id,
        shipmentId: shipment.id,
        lineId: line.id,
      };
    });

    try {
      const concurrentDb = makeDb(DATABASE_URL as string);
      const concurrent = wireLogistics(makeDbService(concurrentDb.db), 'v2');
      try {
        await Promise.all([
          wired.shipmentReservations.reservePartial(ids.lineId, 10),
          concurrent.shipmentReservations.reservePartial(ids.lineId, 10),
        ]);
      } finally {
        await concurrentDb.sql.end();
      }

      const reservations = await db
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, ids.lineId));
      expect(reservations).toHaveLength(1);
      expect(reservations[0].quantity).toBe(6);
      const [shipment] = await db.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, ids.shipmentId));
      expect(shipment.reservationVersion).toBe(2);
    } finally {
      await db.transaction(async (tx) => {
        await tx.delete(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, ids.lineId));
        await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, ids.lineId));
        await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, ids.shipmentId));
        await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, ids.itemId));
        await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, ids.foId));
        await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, ids.skuId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, ids.skuId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, ids.holderId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, ids.locationId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouseId));
      });
    }
  });

  it('avoids an operation/graph cycle between reservation replay and resume-style graph locking', async () => {
    const ids = await db.transaction(async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ warehouseId, totalItems: 1, totalQty: 1 })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fo.id, skuId, qty: 1 })
        .returning();
      const [shipment] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'draft' }).returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({ shipmentId: shipment.id, fulfillmentOrderItemId: item.id, skuId, qty: 1 })
        .returning();
      const operationId = randomUUID();
      const actorId = randomUUID();
      await tx.insert(wmsTables.shipmentOperations).values({
        id: operationId,
        type: 'short_pick',
        status: 'pending',
        operatorId: actorId,
        reason: 'concurrency proof',
        idempotencyKey: `reservation-cycle-${randomUUID()}`,
        requestHash: 'f'.repeat(64),
        beforeManifestSnapshot: {
          intent: {
            kind: 'short_pick',
            operationId,
            shipmentId: shipment.id,
            sessionId: randomUUID(),
            actorId,
            reason: 'concurrency proof',
            lines: [
              {
                shipmentLineId: line.id,
                sourceLocationId: locationId,
                shortQty: 1,
                allocationQty: 1,
              },
            ],
          },
        },
      });
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId,
        shipmentId: shipment.id,
        role: 'source',
      });
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'SHIPMENT_LINE',
        targetId: line.id,
        shipmentLineId: line.id,
        skuId,
        warehouseId,
        quantity: 1,
        status: 'released',
        requestedAt: line.createdAt,
        stateReason: `short-pick:${operationId}`,
        invalidatedAt: new Date(),
      });
      return {
        warehouseId,
        locationId,
        holderId,
        skuId,
        foId: fo.id,
        itemId: item.id,
        shipmentId: shipment.id,
        lineId: line.id,
        operationId,
      };
    });

    const concurrentDb = makeDb(DATABASE_URL as string);
    const concurrent = wireLogistics(makeDbService(concurrentDb.db), 'v2');
    let announceOperationLock!: () => void;
    const operationLocked = new Promise<void>((resolve) => {
      announceOperationLock = resolve;
    });
    let allowGraphLock!: () => void;
    const graphGate = new Promise<void>((resolve) => {
      allowGraphLock = resolve;
    });
    let resumeStyle: Promise<void> | undefined;
    let reservationReplay: ReturnType<typeof wired.shipmentReservations.invalidateForShortPick> | undefined;
    try {
      resumeStyle = concurrentDb.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        await tx.execute(sql`
          SELECT operation.id
            FROM shipment_operations operation
            JOIN shipment_operation_members member ON member.operation_id = operation.id
           WHERE operation.id = ${ids.operationId}::uuid
             AND member.shipment_id = ${ids.shipmentId}::uuid
             AND member.role = 'source'
           FOR UPDATE
        `);
        announceOperationLock();
        await graphGate;
        await concurrent.shipmentReservations.lockShipmentGraphForDispatch(ids.shipmentId, tx as unknown as DbTx);
      });
      await operationLocked;
      reservationReplay = wired.shipmentReservations.invalidateForShortPick(ids.lineId, 1, ids.operationId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      allowGraphLock();

      const [, replay] = await Promise.all([resumeStyle, reservationReplay]);
      expect(replay).toMatchObject({ replayed: true, invalidatedQty: 1 });
    } finally {
      allowGraphLock();
      await Promise.allSettled([resumeStyle ?? Promise.resolve(), reservationReplay ?? Promise.resolve()]);
      await concurrentDb.sql.end();
      await db.transaction(async (tx) => {
        await tx.delete(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, ids.lineId));
        await tx
          .delete(wmsTables.shipmentOperationMembers)
          .where(eq(wmsTables.shipmentOperationMembers.operationId, ids.operationId));
        await tx.delete(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, ids.operationId));
        await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, ids.lineId));
        await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, ids.shipmentId));
        await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, ids.itemId));
        await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, ids.foId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, ids.skuId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, ids.holderId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, ids.locationId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouseId));
      });
    }
  });

  it('uses one global row-lock order for inverse concurrent transfers', async () => {
    const ids = await db.transaction(async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId,
        warehouseId,
        locationId,
        stockState: 'ON_HAND',
        qty: 10,
      });
      const fos = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values([
          { warehouseId, totalItems: 1, totalQty: 10 },
          { warehouseId, totalItems: 1, totalQty: 10 },
        ])
        .returning();
      const items = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values(fos.map((fo) => ({ fulfillmentOrderId: fo.id, skuId, qty: 10, reservedQty: 5 })))
        .returning();
      const shipments = await tx
        .insert(wmsTables.shipments)
        .values(fos.map(() => ({ warehouseId, status: 'draft' as const })))
        .returning();
      const lines = await tx
        .insert(wmsTables.shipmentLines)
        .values(
          items.map((item, index) => ({
            shipmentId: shipments[index].id,
            fulfillmentOrderItemId: item.id,
            skuId,
            qty: 10,
            reservedQty: 5,
          })),
        )
        .returning();
      const requestedAt = new Date(Date.now() - 60_000);
      await tx.insert(wmsTables.stockReservations).values(
        lines.map((line) => ({
          targetType: 'SHIPMENT_LINE',
          targetId: line.id,
          shipmentLineId: line.id,
          skuId,
          warehouseId,
          quantity: 5,
          status: 'confirmed' as const,
          requestedAt,
        })),
      );
      return {
        warehouseId,
        locationId,
        holderId,
        skuId,
        foIds: fos.map((row) => row.id),
        itemIds: items.map((row) => row.id),
        shipmentIds: shipments.map((row) => row.id),
        lineIds: lines.map((row) => row.id),
      };
    });

    try {
      const concurrentDb = makeDb(DATABASE_URL as string);
      const concurrent = wireLogistics(makeDbService(concurrentDb.db), 'v2');
      try {
        await Promise.all([
          wired.shipmentReservations.transfer(ids.lineIds[0], ids.lineIds[1], 2),
          concurrent.shipmentReservations.transfer(ids.lineIds[1], ids.lineIds[0], 2),
        ]);
      } finally {
        await concurrentDb.sql.end();
      }

      const reservations = await db
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            inArray(wmsTables.stockReservations.shipmentLineId, ids.lineIds),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      const totals = new Map(ids.lineIds.map((lineId) => [lineId, 0]));
      for (const reservation of reservations) {
        if (!reservation.shipmentLineId) continue;
        totals.set(reservation.shipmentLineId, (totals.get(reservation.shipmentLineId) ?? 0) + reservation.quantity);
      }
      expect(totals.get(ids.lineIds[0])).toBe(5);
      expect(totals.get(ids.lineIds[1])).toBe(5);
      const shipments = await db
        .select()
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, ids.shipmentIds));
      expect(shipments.every((shipment) => shipment.reservationVersion === 3)).toBe(true);
    } finally {
      await db.transaction(async (tx) => {
        await tx
          .delete(wmsTables.stockReservations)
          .where(inArray(wmsTables.stockReservations.shipmentLineId, ids.lineIds));
        await tx.delete(wmsTables.shipmentLines).where(inArray(wmsTables.shipmentLines.id, ids.lineIds));
        await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, ids.shipmentIds));
        await tx
          .delete(wmsTables.fulfillmentOrderItems)
          .where(inArray(wmsTables.fulfillmentOrderItems.id, ids.itemIds));
        await tx.delete(wmsTables.fulfillmentOrders).where(inArray(wmsTables.fulfillmentOrders.id, ids.foIds));
        await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, ids.skuId));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, ids.skuId));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, ids.holderId));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, ids.locationId));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouseId));
      });
    }
  });
});
