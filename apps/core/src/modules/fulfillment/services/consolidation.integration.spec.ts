import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
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
import { ConsolidationService } from './consolidation.service';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const RECIPIENT = {
  recipientName: 'Consolidation Customer',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

describeIfDb('V2 explicit shipment consolidation (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let dbService: ReturnType<typeof makeDbService>;
  let wired: Wired;
  let consolidation: ConsolidationService;
  let planning: ShipmentPlanningService;
  const actor = { id: randomUUID(), roles: ['logistics_manager'] };
  const customerId = randomUUID();

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    consolidation = new ConsolidationService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      {
        getScopesByRoles: () =>
          Promise.resolve(
            new Set([
              FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
              FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
              FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
            ]),
          ),
      } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
    planning = new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      { getScopesByRoles: () => Promise.resolve(new Set([FULFILLMENT_SCOPE.SHIPMENT_REOPEN])) } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
  });

  afterAll(async () => {
    await client.end();
  });

  async function baseFixture(tx: DbTx, onHand = 100) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `consolidation-profile-${randomUUID()}`,
        sourceType: 'in_house',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId,
      locationId,
      stockState: 'ON_HAND',
      qty: onHand,
    });
    return { warehouseId, skuId, profileId: profile.id };
  }

  async function createOrderShipment(
    tx: DbTx,
    base: Awaited<ReturnType<typeof baseFixture>>,
    options: {
      quantity: number;
      recipient?: typeof RECIPIENT;
      salesChannel?: 'medusa' | 'naver' | 'coupang';
      customerId?: string;
    },
  ) {
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: [{ variantId, quantity: options.quantity }],
    });
    await tx
      .update(wmsTables.salesOrders)
      .set({
        salesChannel: options.salesChannel ?? 'medusa',
        customerId: options.customerId ?? customerId,
        customerName: 'Consolidation Customer',
        customerPhone: '010-1111-2222',
        shippingAddress: options.recipient ?? RECIPIENT,
      })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    await seedMatching(tx, { variantId, skuId: base.skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: base.warehouseId }, tx);
    const [row] = await tx
      .select({
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        fulfillmentOrderItemId: wmsTables.fulfillmentOrderItems.id,
        shipmentLineId: wmsTables.shipmentLines.id,
        shipmentId: wmsTables.shipments.id,
      })
      .from(wmsTables.fulfillmentOrders)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, wmsTables.fulfillmentOrders.id),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.fulfillmentOrderItemId, wmsTables.fulfillmentOrderItems.id),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, row.shipmentId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, row.shipmentLineId));
    return { salesOrderId, ...row, shipment, line };
  }

  function requestFor(...fixtures: Array<Awaited<ReturnType<typeof createOrderShipment>>>) {
    return fixtures.map((fixture) => ({
      shipmentId: fixture.shipment.id,
      expectedManifestVersion: fixture.shipment.manifestVersion,
      expectedReservationVersion: fixture.shipment.reservationVersion,
    }));
  }

  it('supersedes two FO shipments into one Draft target and replays the same operation', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 3 });
      const second = await createOrderShipment(tx, base, { quantity: 2 });
      const dto = {
        sources: requestFor(second, first),
        recipientSourceShipmentId: first.shipment.id,
        reason: 'customer approved one box',
      };
      const key = `consolidate-${randomUUID()}`;
      const result = await consolidation.consolidate(dto, key, actor, tx);

      expect(result).toMatchObject({ operationStatus: 'completed', targetShipmentId: expect.any(String) });
      expect(result.sourceShipmentIds).toEqual([first.shipment.id, second.shipment.id].sort());
      const sources = await tx
        .select()
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, [first.shipment.id, second.shipment.id]));
      expect(sources.every((source) => source.status === 'superseded' && source.supersededAt)).toBe(true);
      expect(sources.every((source) => source.manifestVersion === 2 && source.reservationVersion === 3)).toBe(true);
      const [target] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, result.targetShipmentId!));
      expect(target).toMatchObject({
        status: 'draft',
        openedForFulfillmentOrderId: null,
        shippingProfileId: base.profileId,
        manifestVersion: 1,
        reservationVersion: 2,
        recipientSnapshot: RECIPIENT,
      });
      const targetLines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, target.id));
      expect(targetLines).toHaveLength(2);
      expect(targetLines.reduce((sum, line) => sum + line.qty, 0)).toBe(5);
      expect(targetLines.reduce((sum, line) => sum + line.reservedQty, 0)).toBe(5);
      const confirmed = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            inArray(
              wmsTables.stockReservations.shipmentLineId,
              targetLines.map((line) => line.id),
            ),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(confirmed.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);
      const members = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, result.operationId));
      expect(members.filter((member) => member.role === 'source')).toHaveLength(2);
      expect(members.filter((member) => member.role === 'target')).toHaveLength(1);
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation).toMatchObject({ status: 'completed', operatorId: actor.id });
      expect(operation.beforeManifestSnapshot).toBeTruthy();
      expect(operation.afterManifestSnapshot).toBeTruthy();
      const replay = await consolidation.consolidate(dto, key, actor, tx);
      expect(replay).toEqual(result);
    });
  });

  it("cancels one source order's consolidated line and replans the surviving target", async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx);
      const canceledSource = await createOrderShipment(tx, base, { quantity: 3 });
      const survivingSource = await createOrderShipment(tx, base, { quantity: 2 });
      const consolidated = await consolidation.consolidate(
        {
          sources: requestFor(canceledSource, survivingSource),
          recipientSourceShipmentId: canceledSource.shipment.id,
          reason: 'consolidate before source cancellation',
        },
        `consolidate-before-cancel-${randomUUID()}`,
        actor,
        tx,
      );
      const targetShipmentId = consolidated.targetShipmentId!;
      const targetLines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, targetShipmentId));
      const canceledTargetLine = targetLines.find(
        (line) => line.fulfillmentOrderItemId === canceledSource.fulfillmentOrderItemId,
      );
      expect(canceledTargetLine).toBeDefined();

      const cancelDto = {
        expectedManifestVersion: consolidated.target!.manifestVersion,
        reason: 'source order canceled after consolidation',
        lines: [
          {
            shipmentLineId: canceledTargetLine!.id,
            expectedLineVersion: canceledTargetLine!.lineVersion,
            qty: canceledTargetLine!.qty,
          },
        ],
      };
      const cancelKey = `cancel-consolidated-source-${randomUUID()}`;
      const pendingCancellation = await planning.cancelOutstanding(targetShipmentId, cancelDto, cancelKey, actor, tx);
      expect(pendingCancellation).toMatchObject({
        operationStatus: 'pending',
        shipmentId: targetShipmentId,
        manifestVersion: consolidated.target!.manifestVersion,
      });
      const [waitingTarget] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, targetShipmentId));
      expect(waitingTarget).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'CANCEL_REPLAN_PENDING',
        manifestVersion: consolidated.target!.manifestVersion,
      });

      const cancellation = await planning.resumePendingCancellation(pendingCancellation.operationId, tx);
      expect(cancellation.operationStatus).toBe('completed');
      expect(await planning.resumePendingCancellation(pendingCancellation.operationId, tx)).toEqual(cancellation);
      expect(await planning.cancelOutstanding(targetShipmentId, cancelDto, cancelKey, actor, tx)).toEqual(cancellation);

      const [targetAfterCancellation] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, targetShipmentId));
      const remainingLines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, targetShipmentId));
      expect(targetAfterCancellation.status).toBe('draft');
      expect(remainingLines).toHaveLength(1);
      expect(remainingLines[0]).toMatchObject({
        fulfillmentOrderItemId: survivingSource.fulfillmentOrderItemId,
        qty: 2,
        reservedQty: 2,
      });

      const [canceledLineAfter] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, canceledTargetLine!.id));
      const [cancellationTombstone] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, canceledLineAfter.shipmentId));
      expect(cancellationTombstone).toMatchObject({ status: 'canceled', shippingProfileId: base.profileId });
      expect(canceledLineAfter).toMatchObject({ qty: 3, reservedQty: 0 });

      await tx
        .update(wmsTables.deliveryProfiles)
        .set({
          senderSnapshot: { name: 'Sender' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'consolidation-carrier-account',
        })
        .where(eq(wmsTables.deliveryProfiles.id, base.profileId));
      const planned = await planning.plan(
        targetShipmentId,
        {
          shippingProfileId: base.profileId,
          expectedManifestVersion: targetAfterCancellation.manifestVersion,
          expectedReservationVersion: targetAfterCancellation.reservationVersion,
        },
        `replan-after-source-cancel-${randomUUID()}`,
        actor,
        tx,
      );
      expect(planned.shipment).toMatchObject({ shipmentId: targetShipmentId, status: 'planned' });

      const items = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          inArray(wmsTables.fulfillmentOrderItems.id, [
            canceledSource.fulfillmentOrderItemId,
            survivingSource.fulfillmentOrderItemId,
          ]),
        );
      expect(items.find((item) => item.id === canceledSource.fulfillmentOrderItemId)).toMatchObject({
        qty: 3,
        canceledQty: 3,
        reservedQty: 0,
      });
      expect(items.find((item) => item.id === survivingSource.fulfillmentOrderItemId)).toMatchObject({
        qty: 2,
        canceledQty: 0,
        reservedQty: 2,
      });
      await new FulfillmentInvariantService().assertFulfillmentOrders(
        [canceledSource.fulfillmentOrderId, survivingSource.fulfillmentOrderId],
        tx,
      );
    });
  });

  it('coalesces split lines of the same FOI and preserves reservation fairness', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx, 6);
      const fixture = await createOrderShipment(tx, base, { quantity: 10 });
      const [reservationBefore] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      await tx.update(wmsTables.shipmentLines).set({ qty: 6 }).where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const earlierCreatedAt = new Date(fixture.line.createdAt.getTime() - 60_000);
      const [secondShipment] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId: base.warehouseId,
          status: 'draft',
          shippingProfileId: base.profileId,
          recipientSnapshot: RECIPIENT,
          openedBy: actor.id,
        })
        .returning();
      await tx.insert(wmsTables.shipmentLines).values({
        shipmentId: secondShipment.id,
        fulfillmentOrderItemId: fixture.fulfillmentOrderItemId,
        skuId: base.skuId,
        qty: 4,
        createdFromLineId: fixture.line.id,
        createdAt: earlierCreatedAt,
      });
      const result = await consolidation.consolidate(
        {
          sources: [
            {
              shipmentId: fixture.shipment.id,
              expectedManifestVersion: fixture.shipment.manifestVersion,
              expectedReservationVersion: fixture.shipment.reservationVersion,
            },
            {
              shipmentId: secondShipment.id,
              expectedManifestVersion: secondShipment.manifestVersion,
              expectedReservationVersion: secondShipment.reservationVersion,
            },
          ],
          recipientSourceShipmentId: fixture.shipment.id,
          reason: 'merge split backorder lines',
        },
        `coalesce-${randomUUID()}`,
        actor,
        tx,
      );

      const [targetLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, result.targetShipmentId!));
      expect(targetLine).toMatchObject({ qty: 10, reservedQty: 6, createdFromLineId: null });
      expect(targetLine.createdAt.getTime()).toBe(earlierCreatedAt.getTime());
      const [reservationAfter] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.id, reservationBefore.id));
      expect(reservationAfter).toMatchObject({
        shipmentLineId: targetLine.id,
        targetId: targetLine.id,
        quantity: 6,
      });
      expect(reservationAfter.requestedAt?.getTime()).toBe(reservationBefore.requestedAt?.getTime());
    });
  });

  it('returns only conservative same-recipient groups while allowing mixed sales channels', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 1, salesChannel: 'medusa' });
      const second = await createOrderShipment(tx, base, { quantity: 1, salesChannel: 'naver' });
      await createOrderShipment(tx, base, {
        quantity: 1,
        salesChannel: 'coupang',
        recipient: { ...RECIPIENT, detailAddress: 'different unit' },
      });
      await createOrderShipment(tx, base, {
        quantity: 1,
        customerId: randomUUID(),
      });

      const groups = await consolidation.findCandidates(base.warehouseId, first.shipment.id, tx);
      expect(groups).toHaveLength(1);
      expect(groups[0].shipments.map((shipment) => shipment.shipmentId)).toEqual(
        [first.shipment.id, second.shipment.id].sort(),
      );
      expect(groups[0].shipments.flatMap((shipment) => shipment.salesChannels).sort()).toEqual(['medusa', 'naver']);
      const repeated = await consolidation.findCandidates(base.warehouseId, first.shipment.id, tx);
      expect(repeated).toEqual(groups);
    });
  });

  it('requires recipient override scope for mismatched addresses and persists an authorized snapshot', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 1 });
      const secondRecipient = { ...RECIPIENT, detailAddress: '202' };
      const second = await createOrderShipment(tx, base, { quantity: 1, recipient: secondRecipient });
      const dto = {
        sources: requestFor(first, second),
        recipientSourceShipmentId: first.shipment.id,
        reason: 'CS approved first address',
      };
      const withoutOverride = new ConsolidationService(
        dbService,
        new FulfillmentCommandService(dbService),
        wired.shipmentReservations,
        new FulfillmentInvariantService(),
        new AuditService(dbService),
        {
          getScopesByRoles: () => Promise.resolve(new Set([FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE])),
        } as never,
        new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      );
      await expect(
        withoutOverride.consolidate(dto, `override-denied-${randomUUID()}`, { ...actor, roles: ['limited'] }, tx),
      ).rejects.toThrow(`Missing required scope: ${FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT}`);

      const authorized = await consolidation.consolidate(dto, `override-allowed-${randomUUID()}`, actor, tx);
      const [target] = await tx
        .select({ recipient: wmsTables.shipments.recipientSnapshot })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, authorized.targetShipmentId!));
      expect(target.recipient).toEqual(RECIPIENT);
      const [audit] = await tx
        .select()
        .from(wmsTables.auditLogs)
        .where(and(eq(wmsTables.auditLogs.action, 'shipment.consolidate'), eq(wmsTables.auditLogs.userId, actor.id)));
      expect(audit.metadata).toMatchObject({ reason: dto.reason, sourceShipmentIds: expect.any(Array) });
    });
  });

  it('keeps a blocked operation target-free, then resumes by exact operation ID and refreshes replay', async () => {
    await inRollbackTx(db, async (tx) => {
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 1 });
      const second = await createOrderShipment(tx, base, { quantity: 1 });
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'planned' })
        .where(eq(wmsTables.shipments.id, first.shipment.id));
      const [waybill] = await tx
        .insert(wmsTables.waybills)
        .values({
          shipmentId: first.shipment.id,
          source: 'manual',
          carrier: 'HANJIN',
          status: 'registered',
          trackingNo: `consolidation-waybill-${randomUUID()}`,
          manifestVersion: first.shipment.manifestVersion,
          recipientHash: canonicalFulfillmentRequestHash(first.shipment.recipientSnapshot),
        })
        .returning();
      const dto = {
        sources: requestFor(first, second),
        recipientSourceShipmentId: first.shipment.id,
        reason: 'wait for waybill void',
      };
      const key = `pending-consolidation-${randomUUID()}`;
      const pending = await consolidation.consolidate(dto, key, actor, tx);
      expect(pending).toMatchObject({
        operationStatus: 'pending',
        targetShipmentId: null,
        blockers: expect.arrayContaining([
          expect.objectContaining({ shipmentId: first.shipment.id, codes: expect.arrayContaining(['ACTIVE_INVOICE']) }),
        ]),
      });
      expect(
        await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.warehouseId, base.warehouseId)),
      ).toHaveLength(2);
      const waitingSources = await tx
        .select()
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, [first.shipment.id, second.shipment.id]));
      expect(
        waitingSources.every(
          (shipment) => shipment.status === 'recovery_required' && shipment.recoveryCode === 'CONSOLIDATION_PENDING',
        ),
      ).toBe(true);
      await expect(consolidation.consolidate(dto, `second-pending-${randomUUID()}`, actor, tx)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'CONSOLIDATION_ALREADY_PENDING',
          operationId: pending.operationId,
        }),
      });
      const waitingOrders = await tx
        .select({ status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [first.fulfillmentOrderId, second.fulfillmentOrderId]));
      expect(waitingOrders.every((order) => order.status === 'recovery_required')).toBe(true);

      await tx
        .update(wmsTables.waybills)
        .set({ status: 'voided', voidedAt: new Date() })
        .where(eq(wmsTables.waybills.id, waybill.id));
      const completed = await consolidation.resumePending(pending.operationId, tx);
      expect(completed).toMatchObject({
        operationId: pending.operationId,
        operationStatus: 'completed',
        targetShipmentId: expect.any(String),
      });
      const resumedOrders = await tx
        .select({ status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [first.fulfillmentOrderId, second.fulfillmentOrderId]));
      expect(resumedOrders.every((order) => order.status === 'ready')).toBe(true);
      const replay = await consolidation.consolidate(dto, key, actor, tx);
      expect(replay).toEqual(completed);
      const members = await tx
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, pending.operationId));
      expect(members.filter((member) => member.role === 'source')).toHaveLength(2);
      expect(members.filter((member) => member.role === 'target')).toHaveLength(1);
    });
  });

  it('rolls back manifests, lineage and command claim when required audit fails', async () => {
    const committed = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 1 });
      const second = await createOrderShipment(tx, base, { quantity: 1 });
      return { base, first, second };
    });
    const failingAudit = new ConsolidationService(
      dbService,
      new FulfillmentCommandService(dbService),
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      { logUserActionRequired: () => Promise.reject(new Error('required audit unavailable')) } as never,
      {
        getScopesByRoles: () =>
          Promise.resolve(
            new Set([
              FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
              FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
              FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
            ]),
          ),
      } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
    const key = `audit-rollback-${randomUUID()}`;
    await expect(
      failingAudit.consolidate(
        {
          sources: requestFor(committed.first, committed.second),
          recipientSourceShipmentId: committed.first.shipment.id,
          reason: 'must audit atomically',
        },
        key,
        actor,
      ),
    ).rejects.toThrow('required audit unavailable');

    const shipments = await db
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.warehouseId, committed.base.warehouseId));
    expect(shipments).toHaveLength(2);
    expect(shipments.every((shipment) => shipment.status === 'draft')).toBe(true);
    expect(
      await db.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.idempotencyKey, key)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key)),
    ).toHaveLength(0);
  });

  it('serializes different-key concurrent consolidation so only one target is created', async () => {
    const committed = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const base = await baseFixture(tx);
      const first = await createOrderShipment(tx, base, { quantity: 1 });
      const second = await createOrderShipment(tx, base, { quantity: 1 });
      return { base, first, second };
    });
    const firstConnection = makeDb(DATABASE_URL as string);
    const secondConnection = makeDb(DATABASE_URL as string);
    const serviceFor = (database: PostgresJsDatabase<typeof wmsSchema>) => {
      const serviceDb = makeDbService(database);
      const logistics = wireLogistics(serviceDb, 'v2');
      return new ConsolidationService(
        serviceDb,
        new FulfillmentCommandService(serviceDb),
        logistics.shipmentReservations,
        new FulfillmentInvariantService(),
        new AuditService(serviceDb),
        {
          getScopesByRoles: () =>
            Promise.resolve(
              new Set([
                FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
                FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
                FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
              ]),
            ),
        } as never,
        new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      );
    };
    const dto = {
      sources: requestFor(committed.first, committed.second),
      recipientSourceShipmentId: committed.first.shipment.id,
      reason: 'concurrent explicit consolidation',
    };
    try {
      const settled = await Promise.allSettled([
        serviceFor(firstConnection.db).consolidate(dto, `concurrent-a-${randomUUID()}`, actor),
        serviceFor(secondConnection.db).consolidate(dto, `concurrent-b-${randomUUID()}`, actor),
      ]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const sourceMembers = await db
        .select({ operationId: wmsTables.shipmentOperationMembers.operationId })
        .from(wmsTables.shipmentOperationMembers)
        .innerJoin(
          wmsTables.shipmentOperations,
          eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
        )
        .where(
          and(
            inArray(wmsTables.shipmentOperationMembers.shipmentId, [
              committed.first.shipment.id,
              committed.second.shipment.id,
            ]),
            eq(wmsTables.shipmentOperationMembers.role, 'source'),
            eq(wmsTables.shipmentOperations.type, 'consolidate'),
          ),
        );
      const operationIds = [...new Set(sourceMembers.map((member) => member.operationId))];
      expect(operationIds).toHaveLength(1);
      const targetMembers = await db
        .select({ shipmentId: wmsTables.shipmentOperationMembers.shipmentId })
        .from(wmsTables.shipmentOperationMembers)
        .where(
          and(
            eq(wmsTables.shipmentOperationMembers.operationId, operationIds[0]),
            eq(wmsTables.shipmentOperationMembers.role, 'target'),
          ),
        );
      expect(targetMembers).toHaveLength(1);
    } finally {
      await firstConnection.sql.end();
      await secondConnection.sql.end();
    }
  });
});
