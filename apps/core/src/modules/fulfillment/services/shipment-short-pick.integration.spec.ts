import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from './__support__';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { canonicalShipmentRecipientHash, InvoiceOrchestrator } from './invoice-orchestrator.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ShipmentShortPickService } from './shipment-short-pick.service';
import { ToteLifecycleService } from './tote-lifecycle.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const RECIPIENT = {
  recipientName: 'Short pick integration',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

describeIfDb('ShipmentShortPickService (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (trx: DbTx) => Promise<T>, explicit?: DbTx): Promise<T> => {
        if (explicit) return fn(explicit);
        return (tx as unknown as { transaction<R>(callback: (nested: unknown) => Promise<R>): Promise<R> }).transaction(
          (nested) => fn(nested as DbTx),
        );
      },
    } as unknown as DbService<typeof wmsSchema>;
  }

  function provider() {
    return {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: false, lookupByServiceId: true },
      },
      issueInvoice: jest.fn(),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
      queryInvoice: jest.fn().mockResolvedValue({
        status: 'found',
        tracking: { status: 'canceled' },
      }),
    };
  }

  function services(tx: DbTx, deliveryProvider = provider()) {
    const dbService = ambientDbService(tx);
    const workflowGate = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const audit = new AuditService(dbService);
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const logistics = wireLogistics(dbService, 'v2');
    const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['master'])) };
    const planning = new ShipmentPlanningService(
      dbService,
      commands,
      logistics.shipmentReservations,
      invariant,
      audit,
      authorization as never,
      workflowGate,
    );
    const sessions = new BatchInventorySessionService(dbService, new BatchControlledStockGuard(), audit);
    let shortPick!: ShipmentShortPickService;
    const moduleRef = { get: jest.fn(() => shortPick) };
    const invoices = new InvoiceOrchestrator(
      dbService,
      commands,
      invariant,
      audit,
      deliveryProvider as never,
      deliveryProvider as never,
      workflowGate,
      moduleRef as never,
    );
    const totes = new ToteLifecycleService(dbService);
    shortPick = new ShipmentShortPickService(
      dbService,
      commands,
      authorization as never,
      audit,
      workflowGate,
      invoices,
      sessions,
      logistics.shipmentReservations,
      planning,
      totes,
    );
    return { shortPick, invoices, sessions, planning, logistics, deliveryProvider, moduleRef };
  }

  async function sharedBatchFixture(tx: DbTx, options: { invoiceA?: boolean; invoiceB?: boolean } = {}) {
    const actor = { id: randomUUID(), roles: ['master'] };
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `short-pick-profile-${randomUUID()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
    const [ledger] = await tx
      .insert(wmsTables.stockLedgers)
      .values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 10 })
      .returning();

    const seedShipment = async (label: string) => {
      const variantId = randomUUID();
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `short-pick-${label}-${randomUUID()}`,
          salesChannel: 'medusa',
          status: 'confirmed',
          shippingAddress: RECIPIENT,
          orderDate: new Date(),
        })
        .returning();
      const [salesLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: salesOrder.id,
          variantId,
          productName: `Short pick ${label}`,
          quantity: 5,
          unitPrice: 1_000,
          channelOrderItemId: `item-${label}-${randomUUID()}`,
          channelProductId: `product-${label}-${randomUUID()}`,
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: salesOrder.id,
          warehouseId,
          ownerId: holderId,
          status: 'picking',
          fulfillmentMode: 'in_house',
          totalItems: 1,
          totalQty: 5,
          totalReservedQty: 5,
        })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fulfillmentOrder.id,
          salesOrderId: salesOrder.id,
          salesOrderLineId: salesLine.id,
          variantId,
          skuId,
          qty: 5,
          reservedQty: 5,
          pickedQty: 5,
          status: 'picking',
        })
        .returning();
      const [shipment] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId,
          openedForFulfillmentOrderId: fulfillmentOrder.id,
          status: 'planned',
          shippingProfileId: profile.id,
          recipientSnapshot: RECIPIENT,
          manifestVersion: 1,
          reservationVersion: 1,
          plannedAt: new Date(),
        })
        .returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: shipment.id,
          fulfillmentOrderItemId: item.id,
          skuId,
          qty: 5,
          reservedQty: 5,
          inspectedQty: 0,
          lineVersion: 1,
        })
        .returning();
      const requestedAt = new Date(Date.now() - 60_000);
      const [reservation] = await tx
        .insert(wmsTables.stockReservations)
        .values({
          targetType: 'SHIPMENT_LINE',
          targetId: line.id,
          fulfillmentOrderItemId: item.id,
          shipmentLineId: line.id,
          skuId,
          warehouseId,
          quantity: 5,
          status: 'confirmed',
          reason: `short-pick-${label}`,
          requestedAt,
        })
        .returning();
      return { salesOrder, salesLine, fulfillmentOrder, item, shipment, line, reservation, requestedAt };
    };

    const a = await seedShipment('a');
    const b = await seedShipment('b');
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `short-pick-shared-${randomUUID()}`,
        warehouseId,
        pickingMethod: 'total_picking',
        status: 'picking',
        totalItems: 2,
        totalQty: 10,
      })
      .returning();
    const [workA, workB] = await tx
      .insert(wmsTables.outboundBatchWorkItems)
      .values([
        { batchId: batch.id, shipmentId: a.shipment.id, status: 'picking', leaseVersion: 1, pickerId: actor.id },
        { batchId: batch.id, shipmentId: b.shipment.id, status: 'picking', leaseVersion: 1 },
      ])
      .returning();
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'aggregate_then_sort', status: 'draft', version: 1, createdBy: actor.id })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values([
      { planId: plan.id, shipmentId: a.shipment.id, manifestVersion: 1, reservationVersion: 1 },
      { planId: plan.id, shipmentId: b.shipment.id, manifestVersion: 1, reservationVersion: 1 },
    ]);
    await tx.insert(wmsTables.pickingSourceAllocations).values([
      {
        planId: plan.id,
        shipmentLineId: a.line.id,
        sourceLocationId: locationId,
        qty: 5,
        sourceStockVersion: ledger.version,
      },
      {
        planId: plan.id,
        shipmentLineId: b.line.id,
        sourceLocationId: locationId,
        qty: 5,
        sourceStockVersion: ledger.version,
      },
    ]);
    const wired = services(tx);
    const session = await wired.sessions.startSession(batch.id, plan.id, tx, actor.id);
    await tx
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'ready_to_pack' })
      .where(eq(wmsTables.outboundBatchWorkItems.id, workB.id));
    const [tote] = await tx
      .insert(wmsTables.totes)
      .values({ warehouseId, barcode: `short-pick-a-${randomUUID()}`, status: 'in_use' })
      .returning();
    const [toteAssignment] = await tx
      .insert(wmsTables.shipmentToteAssignments)
      .values({ shipmentId: a.shipment.id, toteId: tote.id, assignedBy: actor.id })
      .returning();

    const seedInvoice = async (member: typeof a, suffix: string) => {
      const [invoice] = await tx
        .insert(wmsTables.invoices)
        .values({
          trackingNo: `short-pick-${suffix}-${randomUUID()}`,
          carrier: 'CJ',
          issueMethod: 'goodsflow',
          externalServiceId: `service-${suffix}-${randomUUID()}`,
          issuedForFulfillmentOrderId: member.fulfillmentOrder.id,
          shipmentId: member.shipment.id,
          manifestVersion: member.shipment.manifestVersion,
          recipientHash: canonicalShipmentRecipientHash(RECIPIENT),
          status: 'issued',
        })
        .returning();
      return invoice;
    };
    const invoiceA = options.invoiceA === false ? undefined : await seedInvoice(a, 'a');
    const invoiceB = options.invoiceB === false ? undefined : await seedInvoice(b, 'b');
    const dto = {
      workItemId: workA.id,
      expectedWorkItemLeaseVersion: workA.leaseVersion,
      planId: plan.id,
      expectedPlanVersion: plan.version,
      sessionId: session.id,
      expectedSessionVersion: session.version,
      expectedManifestVersion: a.shipment.manifestVersion,
      lines: [
        {
          shipmentLineId: a.line.id,
          sourceLocationId: locationId,
          expectedLineVersion: a.line.lineVersion,
          shortQty: 1,
        },
      ],
      reason: 'inventory_shortage' as const,
    };
    return {
      actor,
      warehouseId,
      locationId,
      skuId,
      a,
      b,
      batch,
      workA,
      workB,
      plan,
      session,
      tote,
      toteAssignment,
      invoiceA,
      invoiceB,
      dto,
      ...wired,
    };
  }

  it('isolates A, preserves B and good reservation quantity, then resumes the exact issued-invoice void saga', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await sharedBatchFixture(tx);
      const idempotencyKey = `short-pick-success-${randomUUID()}`;

      const reported = await fixture.shortPick.report(
        fixture.a.shipment.id,
        fixture.dto,
        idempotencyKey,
        fixture.actor,
      );
      const duplicate = await fixture.shortPick.report(
        fixture.a.shipment.id,
        fixture.dto,
        idempotencyKey,
        fixture.actor,
      );

      expect(duplicate).toEqual(reported);
      expect(reported).toMatchObject({
        shipmentId: fixture.a.shipment.id,
        operationStatus: 'pending',
        workItemId: fixture.workA.id,
      });
      expect(reported.invoiceOperationId).not.toBeNull();
      const reservationsA = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.a.line.id));
      const confirmedA = reservationsA.filter((reservation) => reservation.status === 'confirmed');
      const releasedA = reservationsA.filter(
        (reservation) =>
          reservation.status === 'released' && reservation.stateReason === `short-pick:${reported.operationId}`,
      );
      expect(confirmedA).toHaveLength(1);
      expect(confirmedA[0]).toMatchObject({ quantity: 4, requestedAt: fixture.a.requestedAt });
      expect(releasedA).toHaveLength(1);
      expect(releasedA[0]).toMatchObject({ quantity: 1, requestedAt: fixture.a.requestedAt });
      const reservationsB = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.b.line.id));
      expect(reservationsB).toHaveLength(1);
      expect(reservationsB[0]).toMatchObject({ status: 'confirmed', quantity: 5, requestedAt: fixture.b.requestedAt });

      const sessionEvents = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, fixture.session.id));
      expect(sessionEvents.filter((event) => event.eventType === 'APPROVE_SHORTAGE')).toHaveLength(1);
      expect(sessionEvents.filter((event) => event.eventType === 'RETURN_TO_SOURCE')).toHaveLength(1);
      const [remainingPool] = await tx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, fixture.session.id));
      expect(Number(remainingPool.qty)).toBe(5);
      const [recoveringWorkA] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workA.id));
      const [readyWorkB] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workB.id));
      expect(recoveringWorkA).toMatchObject({
        status: 'short_pick_recovery',
        waitingOperationId: reported.operationId,
        leaseVersion: 2,
        pickerId: null,
      });
      expect(readyWorkB).toMatchObject({ status: 'ready_to_pack', leaseVersion: 1 });
      const [releasedTote] = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.id, fixture.toteAssignment.id));
      expect(releasedTote.releasedAt).not.toBeNull();

      const completedInvoice = await fixture.invoices.processOperation(reported.invoiceOperationId!);

      expect(completedInvoice).toMatchObject({ operationId: reported.invoiceOperationId, status: 'succeeded' });
      expect(fixture.deliveryProvider.cancelInvoice).toHaveBeenCalledTimes(1);
      const [shipmentA] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.a.shipment.id));
      const [shipmentB] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.b.shipment.id));
      const [excludedWorkA] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workA.id));
      const [stillReadyWorkB] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workB.id));
      const [memberA] = await tx
        .select()
        .from(wmsTables.pickingPlanMembers)
        .where(
          and(
            eq(wmsTables.pickingPlanMembers.planId, fixture.plan.id),
            eq(wmsTables.pickingPlanMembers.shipmentId, fixture.a.shipment.id),
          ),
        );
      const [memberB] = await tx
        .select()
        .from(wmsTables.pickingPlanMembers)
        .where(
          and(
            eq(wmsTables.pickingPlanMembers.planId, fixture.plan.id),
            eq(wmsTables.pickingPlanMembers.shipmentId, fixture.b.shipment.id),
          ),
        );
      const [invoiceB] = await tx
        .select()
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, fixture.invoiceB!.id));
      const [shortOperation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, reported.operationId));

      expect(shipmentA).toMatchObject({
        status: 'draft',
        recoveryCode: null,
        manifestVersion: 2,
        reservationVersion: 2,
        plannedAt: null,
      });
      expect(excludedWorkA).toMatchObject({ status: 'excluded', waitingOperationId: null });
      expect(memberA).toMatchObject({
        retiredByOperationId: reported.operationId,
        retiredByOperationType: 'short_pick',
      });
      expect(memberA.retiredAt).not.toBeNull();
      expect(shortOperation).toMatchObject({ status: 'completed', lastError: null });
      expect(shipmentB).toMatchObject({ status: 'planned', manifestVersion: 1, reservationVersion: 1 });
      expect(stillReadyWorkB).toMatchObject({ status: 'ready_to_pack', leaseVersion: 1 });
      expect(memberB.retiredAt).toBeNull();
      expect(invoiceB.status).toBe('issued');
    });
  });

  it('keeps provider void failure retryable on the same invoice operation and resumes after its retry', async () => {
    await inRollbackTx(db, async (tx) => {
      const deliveryProvider = provider();
      deliveryProvider.cancelInvoice.mockRejectedValueOnce(new Error('provider timeout'));
      const fixture = await sharedBatchFixture(tx);
      // Replace only the saga/service graph while retaining the exact seeded batch.
      const retryServices = services(tx, deliveryProvider);
      const reported = await retryServices.shortPick.report(
        fixture.a.shipment.id,
        fixture.dto,
        `short-pick-failure-${randomUUID()}`,
        fixture.actor,
      );

      await retryServices.invoices.processOperation(reported.invoiceOperationId!);
      const [failedInvoiceOperation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, reported.invoiceOperationId!));
      const [recoveringShortOperation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, reported.operationId));
      const [recoveringShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.a.shipment.id));
      expect(failedInvoiceOperation).toMatchObject({ status: 'recovery_required', attempts: 1 });
      expect(failedInvoiceOperation.nextRetryAt).not.toBeNull();
      expect(recoveringShortOperation.status).toBe('recovery_required');
      expect(recoveringShipment).toMatchObject({
        status: 'recovery_required',
        recoveryCode: 'SHORT_PICK_PENDING',
      });

      await tx
        .update(wmsTables.invoiceOperations)
        .set({ nextRetryAt: new Date(0) })
        .where(eq(wmsTables.invoiceOperations.id, reported.invoiceOperationId!));
      const retried = await retryServices.invoices.processOperation(reported.invoiceOperationId!);
      const invoiceOperations = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.resumeOperationId, reported.operationId));
      const [completedShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.a.shipment.id));
      const [completedShortOperation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, reported.operationId));

      expect(retried).toMatchObject({ operationId: reported.invoiceOperationId, status: 'succeeded', attempts: 2 });
      expect(invoiceOperations).toHaveLength(1);
      expect(invoiceOperations[0].id).toBe(reported.invoiceOperationId);
      expect(deliveryProvider.cancelInvoice).toHaveBeenCalledTimes(1);
      expect(deliveryProvider.queryInvoice).toHaveBeenCalledTimes(1);
      expect(completedShipment.status).toBe('draft');
      expect(completedShortOperation.status).toBe('completed');
    });
  });

  it.each(['issuing', 'voiding', 'recovery_required'] as const)(
    'rejects an active %s invoice before physical mutation',
    async (invoiceStatus) => {
      await inRollbackTx(db, async (tx) => {
        const fixture = await sharedBatchFixture(tx);
        await tx
          .update(wmsTables.invoices)
          .set({ status: invoiceStatus })
          .where(eq(wmsTables.invoices.id, fixture.invoiceA!.id));

        await expect(
          fixture.shortPick.report(
            fixture.a.shipment.id,
            fixture.dto,
            `short-pick-nonvoidable-${invoiceStatus}-${randomUUID()}`,
            fixture.actor,
          ),
        ).rejects.toMatchObject({ response: { code: 'SHORT_PICK_INVOICE_NOT_VOIDABLE' } });

        const [shipment] = await tx
          .select()
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, fixture.a.shipment.id));
        const [work] = await tx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workA.id));
        const shortEvents = await tx
          .select()
          .from(wmsTables.batchInventorySessionEvents)
          .where(
            and(
              eq(wmsTables.batchInventorySessionEvents.sessionId, fixture.session.id),
              sql`${wmsTables.batchInventorySessionEvents.eventType} <> 'HAND_IN'`,
            ),
          );
        const operations = await tx
          .select()
          .from(wmsTables.shipmentOperations)
          .where(eq(wmsTables.shipmentOperations.type, 'short_pick'));
        expect(shipment).toMatchObject({ status: 'planned', recoveryCode: null });
        expect(work).toMatchObject({ status: 'picking', leaseVersion: 1, pickerId: fixture.actor.id });
        expect(shortEvents).toHaveLength(0);
        expect(operations).toHaveLength(0);
      });
    },
  );

  it('finalizes only the affected shipment and leaves its sibling work item dispatchable', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const actorId = randomUUID();
      const operationId = randomUUID();
      const affectedShipmentId = randomUUID();
      const siblingShipmentId = randomUUID();
      const affectedWorkItemId = randomUUID();
      const siblingWorkItemId = randomUUID();
      const planId = randomUUID();
      const sessionId = randomUUID();
      const shipmentLineId = randomUUID();

      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `short-pick-it-${randomUUID()}`,
          warehouseId,
          pickingMethod: 'individual',
          status: 'picking',
        })
        .returning();
      await tx.insert(wmsTables.shipments).values([
        {
          id: affectedShipmentId,
          warehouseId,
          status: 'recovery_required',
          recoveryCode: 'SHORT_PICK_PENDING',
          manifestVersion: 4,
          reservationVersion: 3,
          plannedAt: new Date(),
        },
        {
          id: siblingShipmentId,
          warehouseId,
          status: 'planned',
          manifestVersion: 2,
          reservationVersion: 2,
          plannedAt: new Date(),
        },
      ]);
      await tx.insert(wmsTables.pickingPlans).values({
        id: planId,
        batchId: batch.id,
        strategy: 'discrete',
        status: 'active',
        version: 1,
        createdBy: actorId,
      });
      await tx.insert(wmsTables.batchInventorySessions).values({
        id: sessionId,
        batchId: batch.id,
        status: 'active',
        version: 1,
      });

      const intent = {
        kind: 'short_pick' as const,
        operationId,
        shipmentId: affectedShipmentId,
        workItemId: affectedWorkItemId,
        planId,
        sessionId,
        reason: 'inventory_shortage' as const,
        actorId,
        lines: [
          {
            shipmentLineId,
            sourceLocationId: locationId,
            expectedLineVersion: 1,
            shortQty: 1,
            allocationQty: 1,
          },
        ],
      };
      await tx.insert(wmsTables.shipmentOperations).values({
        id: operationId,
        type: 'short_pick',
        status: 'recovery_required',
        operatorId: actorId,
        reason: intent.reason,
        idempotencyKey: `short-pick-${randomUUID()}`,
        requestHash: 'a'.repeat(64),
        beforeManifestSnapshot: { intent },
        lastError: 'invoice void retry completed',
      });
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId,
        shipmentId: affectedShipmentId,
        role: 'source',
        beforeManifestVersion: 4,
      });
      await tx.insert(wmsTables.outboundBatchWorkItems).values([
        {
          id: affectedWorkItemId,
          batchId: batch.id,
          shipmentId: affectedShipmentId,
          status: 'short_pick_recovery',
          leaseVersion: 3,
          recoveryReason: intent.reason,
          waitingOperationId: operationId,
        },
        {
          id: siblingWorkItemId,
          batchId: batch.id,
          shipmentId: siblingShipmentId,
          status: 'ready_to_pack',
          leaseVersion: 2,
        },
      ]);

      const dbService = makeDbService(db);
      const reservations = { lockShipmentGraphForDispatch: jest.fn().mockResolvedValue(undefined) };
      const planning = { retirePickingPlanMemberForShortPick: jest.fn().mockResolvedValue(undefined) };
      const totes = { releaseEmptyAssignmentsForShipment: jest.fn().mockResolvedValue(undefined) };
      const audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };
      const service = new ShipmentShortPickService(
        dbService,
        {} as never,
        {} as never,
        audit as never,
        {} as never,
        {} as never,
        {} as never,
        reservations as never,
        planning as never,
        totes as never,
      );

      const response = await service.resumePending(operationId, tx);

      expect(response).toMatchObject({
        operationId,
        shipmentId: affectedShipmentId,
        operationStatus: 'completed',
        workItemId: affectedWorkItemId,
      });
      const [affectedShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, affectedShipmentId));
      const [affectedWork] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, affectedWorkItemId));
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId));
      const [siblingShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, siblingShipmentId));
      const [siblingWork] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, siblingWorkItemId));

      expect(affectedShipment).toMatchObject({
        status: 'draft',
        recoveryCode: null,
        manifestVersion: 5,
        reservationVersion: 3,
        plannedAt: null,
      });
      expect(affectedWork).toMatchObject({
        status: 'excluded',
        recoveryReason: null,
        waitingOperationId: null,
      });
      expect(operation).toMatchObject({ status: 'completed', lastError: null });
      expect(operation.completedAt).not.toBeNull();
      expect(siblingShipment).toMatchObject({ status: 'planned', manifestVersion: 2, reservationVersion: 2 });
      expect(siblingWork).toMatchObject({ status: 'ready_to_pack', leaseVersion: 2, waitingOperationId: null });
      expect(planning.retirePickingPlanMemberForShortPick).toHaveBeenCalledWith(
        { planId, shipmentId: affectedShipmentId, operationId, reason: intent.reason },
        tx,
      );
      expect(totes.releaseEmptyAssignmentsForShipment).toHaveBeenCalledWith(
        { shipmentId: affectedShipmentId, operationId },
        tx,
      );
      expect(reservations.lockShipmentGraphForDispatch).toHaveBeenCalledWith(affectedShipmentId, tx);
    });
  });

  it('releases an empty physical tote assignment with a tote version bump', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId } = await seedWarehouseWithZone(tx);
      const actorId = randomUUID();
      const [shipment] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
      const [tote] = await tx
        .insert(wmsTables.totes)
        .values({ warehouseId, barcode: `short-pick-tote-${randomUUID()}`, status: 'in_use', version: 7 })
        .returning();
      const [assignment] = await tx
        .insert(wmsTables.shipmentToteAssignments)
        .values({ shipmentId: shipment.id, toteId: tote.id, assignedBy: actorId })
        .returning();
      const service = new ToteLifecycleService(makeDbService(db));

      const result = await service.releaseEmptyAssignmentsForShipment(
        { shipmentId: shipment.id, operationId: randomUUID() },
        tx,
      );

      const [releasedAssignment] = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.id, assignment.id));
      const [availableTote] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, tote.id));
      expect(result).toEqual({ releasedAssignmentIds: [assignment.id], retainedToteIds: [] });
      expect(releasedAssignment.releasedAt).not.toBeNull();
      expect(availableTote).toMatchObject({ status: 'available', version: 8 });
    });
  });
});
