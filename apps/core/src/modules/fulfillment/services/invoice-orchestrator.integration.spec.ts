import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
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
import { InvoiceOrchestrator } from './invoice-orchestrator.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const RECIPIENT = {
  recipientName: 'Invoice Integration',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul road 1',
  detailAddress: '101',
};

describeIfDb('InvoiceOrchestrator (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  const actor = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    wired = wireLogistics(makeDbService(db), 'v2');
  });

  afterAll(async () => {
    await client.end();
  });

  function fakeProvider() {
    return {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: false, lookupByServiceId: true },
      },
      issueInvoice: jest.fn().mockResolvedValue({
        serviceId: `service-${randomUUID()}`,
        invoiceNumber: `tracking-${randomUUID()}`,
        carrierCode: 'CJ',
      }),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
      queryInvoice: jest.fn(),
    };
  }

  function services(
    options: { provider?: ReturnType<typeof fakeProvider>; audit?: AuditService; moduleRef?: any } = {},
  ) {
    const dbService = makeDbService(db);
    const workflowGate = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const planning = new ShipmentPlanningService(
      dbService,
      commands,
      wired.shipmentReservations,
      invariant,
      new AuditService(dbService),
      { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
      workflowGate,
    );
    const provider = options.provider ?? fakeProvider();
    const moduleRef = options.moduleRef ?? { get: jest.fn() };
    const orchestrator = new InvoiceOrchestrator(
      dbService,
      commands,
      invariant,
      options.audit ?? new AuditService(dbService),
      provider as never,
      provider as never,
      workflowGate,
      moduleRef as never,
    );
    return { planning, orchestrator, provider, moduleRef };
  }

  async function plannedFixture(tx: DbTx) {
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `invoice-profile-${randomUUID()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId,
      locationId,
      stockState: 'ON_HAND',
      qty: 2,
    });
    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: RECIPIENT })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    await seedMatching(tx, { variantId, skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId }, tx);
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
      .then((rows) => rows.map((row) => row.shipment_lines));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
    const { planning } = services();
    const planned = await planning.plan(
      shipment.id,
      {
        shippingProfileId: profile.id,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `plan-${randomUUID()}`,
      actor,
      tx,
    );
    return { shipment: planned.shipment, salesOrderLineId: lineIds[0] };
  }

  async function committedPlannedFixture() {
    return db.transaction((tx) => plannedFixture(tx as unknown as DbTx));
  }

  function issueRequest(manifestVersion: number) {
    return {
      expectedManifestVersion: manifestVersion,
      provider: 'goodsflow' as const,
      carrierCode: 'CJ',
      reason: 'print shipment label',
    };
  }

  it('atomically claims a shipment-owned issuing invoice and replays the same invoice operation', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await plannedFixture(tx);
      const { orchestrator } = services();
      const idempotencyKey = `invoice-issue-${randomUUID()}`;
      const request = {
        expectedManifestVersion: fixture.shipment.manifestVersion,
        provider: 'goodsflow' as const,
        carrierCode: 'CJ',
        reason: 'print shipment label',
      };
      const first = await orchestrator.issueForShipment(
        fixture.shipment.shipmentId,
        request,
        idempotencyKey,
        actor,
        tx,
      );
      const replay = await orchestrator.issueForShipment(
        fixture.shipment.shipmentId,
        request,
        idempotencyKey,
        actor,
        tx,
      );
      expect(replay.operationId).toBe(first.operationId);
      expect(first.status).toBe('pending');

      const [operation] = await tx
        .select()
        .from(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.id, first.operationId));
      const [invoice] = await tx
        .select()
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, first.invoiceId as string));
      expect(operation).toMatchObject({
        shipmentId: fixture.shipment.shipmentId,
        invoiceId: invoice.id,
        manifestVersion: fixture.shipment.manifestVersion,
        status: 'pending',
      });
      expect(operation.requestHash).toHaveLength(64);
      expect(operation.recipientHash).toHaveLength(64);
      expect(operation.providerRequest).toMatchObject({
        kind: 'issue',
        shipment: { id: fixture.shipment.shipmentId, recipientSnapshot: RECIPIENT },
        lines: [
          expect.objectContaining({
            salesOrderLineId: fixture.salesOrderLineId,
            channelOrderItemId: expect.stringMatching(/^item-/),
            quantity: 2,
          }),
        ],
      });
      expect(invoice).toMatchObject({
        shipmentId: fixture.shipment.shipmentId,
        manifestVersion: fixture.shipment.manifestVersion,
        recipientHash: operation.recipientHash,
        status: 'issuing',
      });
      await expect(orchestrator.assertDispatchableInvoice(fixture.shipment.shipmentId, tx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SHIPMENT_INVOICE_NOT_READY' }),
      });

      await expect(
        orchestrator.issueForShipment(
          fixture.shipment.shipmentId,
          { ...request, reason: 'different command' },
          idempotencyKey,
          actor,
          tx,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        orchestrator.issueForShipment(fixture.shipment.shipmentId, request, `other-key-${randomUUID()}`, actor, tx),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SHIPMENT_ACTIVE_INVOICE' }) });
    });
  });

  it('persists the provider response before finalizing a shipment-owned issued invoice', async () => {
    const fixture = await committedPlannedFixture();
    const { orchestrator, provider } = services();
    const accepted = await orchestrator.issueForShipment(
      fixture.shipment.shipmentId,
      issueRequest(fixture.shipment.manifestVersion),
      `invoice-success-${randomUUID()}`,
      actor,
    );

    const completed = await orchestrator.processOperation(accepted.operationId);

    const [operation] = await db
      .select()
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.id, accepted.operationId));
    const [invoice] = await db
      .select()
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.id, accepted.invoiceId as string));
    expect(completed.status).toBe('succeeded');
    expect(operation).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      providerResponse: expect.objectContaining({ serviceId: expect.stringMatching(/^service-/) }),
    });
    expect(invoice).toMatchObject({
      status: 'issued',
      externalServiceId: operation.providerResponse?.serviceId,
      trackingNo: operation.providerResponse?.invoiceNumber,
    });
    expect(provider.issueInvoice).toHaveBeenCalledTimes(1);
    await expect(orchestrator.assertDispatchableInvoice(fixture.shipment.shipmentId)).resolves.toMatchObject({
      id: invoice.id,
    });
  });

  it('records a stale provider issue for recovery, then allows its proven live label to be voided', async () => {
    const fixture = await committedPlannedFixture();
    const provider = fakeProvider();
    const staleServiceId = `stale-service-${randomUUID()}`;
    const staleTrackingNo = `stale-tracking-${randomUUID()}`;
    let releaseIssue!: (value: { serviceId: string; invoiceNumber: string; carrierCode: string }) => void;
    let enteredProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      enteredProvider = resolve;
    });
    provider.issueInvoice.mockImplementation(
      () =>
        new Promise((resolve) => {
          enteredProvider();
          releaseIssue = resolve;
        }),
    );
    const { orchestrator } = services({ provider });
    const accepted = await orchestrator.issueForShipment(
      fixture.shipment.shipmentId,
      issueRequest(fixture.shipment.manifestVersion),
      `invoice-stale-${randomUUID()}`,
      actor,
    );

    const processing = orchestrator.processOperation(accepted.operationId);
    await providerEntered;
    await db
      .update(wmsTables.shipments)
      .set({ manifestVersion: sql`${wmsTables.shipments.manifestVersion} + 1` })
      .where(eq(wmsTables.shipments.id, fixture.shipment.shipmentId));
    releaseIssue({ serviceId: staleServiceId, invoiceNumber: staleTrackingNo, carrierCode: 'CJ' });
    await processing;

    const [staleOperation] = await db
      .select()
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.id, accepted.operationId));
    const [staleInvoice] = await db
      .select()
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.id, accepted.invoiceId as string));
    expect(staleOperation).toMatchObject({
      status: 'recovery_required',
      nextRetryAt: null,
      providerResponse: { serviceId: staleServiceId, invoiceNumber: staleTrackingNo, carrierCode: 'CJ' },
    });
    expect(staleInvoice).toMatchObject({
      status: 'recovery_required',
      externalServiceId: staleServiceId,
      trackingNo: staleTrackingNo,
    });

    const voided = await orchestrator.void(
      staleInvoice.id,
      { reason: 'discard stale manifest label' },
      `void-stale-${randomUUID()}`,
      actor,
    );
    await orchestrator.processOperation(voided.operationId);
    const [finalInvoice] = await db.select().from(wmsTables.invoices).where(eq(wmsTables.invoices.id, staleInvoice.id));
    const active = await db
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(eq(wmsTables.invoices.shipmentId, fixture.shipment.shipmentId), ne(wmsTables.invoices.status, 'voided')),
      );
    expect(finalInvoice.status).toBe('voided');
    expect(provider.cancelInvoice).toHaveBeenCalledWith(
      staleServiceId,
      expect.objectContaining({ operationId: voided.operationId }),
    );
    expect(active).toHaveLength(0);
  });

  it('rolls back the command, operation, and placeholder invoice when strict audit persistence fails', async () => {
    const fixture = await committedPlannedFixture();
    const idempotencyKey = `invoice-audit-rollback-${randomUUID()}`;
    const audit = {
      logUserActionRequired: jest.fn().mockRejectedValue(new Error('audit storage unavailable')),
    } as unknown as AuditService;
    const { orchestrator } = services({ audit });

    await expect(
      orchestrator.issueForShipment(
        fixture.shipment.shipmentId,
        issueRequest(fixture.shipment.manifestVersion),
        idempotencyKey,
        actor,
      ),
    ).rejects.toThrow('audit storage unavailable');

    const commands = await db
      .select({ id: wmsTables.fulfillmentCommandRequests.id })
      .from(wmsTables.fulfillmentCommandRequests)
      .where(
        and(
          eq(wmsTables.fulfillmentCommandRequests.commandType, 'shipment.invoice.issue'),
          eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, idempotencyKey),
        ),
      );
    const invoices = await db
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.shipmentId, fixture.shipment.shipmentId));
    const operations = await db
      .select({ id: wmsTables.invoiceOperations.id })
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.shipmentId, fixture.shipment.shipmentId));
    expect(commands).toHaveLength(0);
    expect(invoices).toHaveLength(0);
    expect(operations).toHaveLength(0);
  });

  it('serializes concurrent issue commands to one active invoice', async () => {
    const fixture = await committedPlannedFixture();
    const { orchestrator } = services();
    const request = issueRequest(fixture.shipment.manifestVersion);

    const results = await Promise.allSettled([
      orchestrator.issueForShipment(fixture.shipment.shipmentId, request, `invoice-race-left-${randomUUID()}`, actor),
      orchestrator.issueForShipment(fixture.shipment.shipmentId, request, `invoice-race-right-${randomUUID()}`, actor),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof orchestrator.issueForShipment>>> =>
        result.status === 'fulfilled',
    );
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const active = await db
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(eq(wmsTables.invoices.shipmentId, fixture.shipment.shipmentId), ne(wmsTables.invoices.status, 'voided')),
      );
    expect(active).toHaveLength(1);
    await orchestrator.processOperation(fulfilled[0].value.operationId);
  });

  it('does not resume consolidation after an unknown void and queries before retrying the same operation', async () => {
    const fixture = await committedPlannedFixture();
    const provider = fakeProvider();
    const resumePending = jest.fn().mockResolvedValue({ operationStatus: 'pending', targetShipmentId: null });
    const moduleRef = { get: jest.fn(() => ({ resumePending })) };
    const { orchestrator } = services({ provider, moduleRef });
    const issued = await orchestrator.issueForShipment(
      fixture.shipment.shipmentId,
      issueRequest(fixture.shipment.manifestVersion),
      `invoice-before-consolidation-${randomUUID()}`,
      actor,
    );
    await orchestrator.processOperation(issued.operationId);
    const consolidationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(wmsTables.shipmentOperations).values({
        id: consolidationId,
        type: 'consolidate',
        status: 'pending',
        operatorId: actor.id,
        reason: 'combine shipments',
        idempotencyKey: `consolidate-${randomUUID()}`,
        requestHash: 'c'.repeat(64),
      });
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId: consolidationId,
        shipmentId: fixture.shipment.shipmentId,
        role: 'source',
        beforeManifestVersion: fixture.shipment.manifestVersion,
      });
    });
    provider.cancelInvoice.mockRejectedValueOnce(new Error('provider timeout after request'));
    const voidOperation = await orchestrator.void(
      issued.invoiceId as string,
      { reason: 'void before consolidation', resumeOperationId: consolidationId },
      `invoice-void-timeout-${randomUUID()}`,
      actor,
    );

    await orchestrator.processOperation(voidOperation.operationId);

    const [failedVoid] = await db
      .select()
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.id, voidOperation.operationId));
    const [invoice] = await db
      .select()
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.id, issued.invoiceId as string));
    const [consolidation] = await db
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, consolidationId));
    const targetMembers = await db
      .select()
      .from(wmsTables.shipmentOperationMembers)
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.operationId, consolidationId),
          eq(wmsTables.shipmentOperationMembers.role, 'target'),
        ),
      );
    expect(failedVoid).toMatchObject({ status: 'recovery_required', attempts: 1 });
    expect(invoice.status).toBe('recovery_required');
    expect(consolidation.status).toBe('pending');
    expect(targetMembers).toHaveLength(0);
    expect(resumePending).not.toHaveBeenCalled();

    await expect(
      orchestrator.void(
        invoice.id,
        { reason: 'unsafe new void attempt', resumeOperationId: consolidationId },
        `invoice-second-void-${randomUUID()}`,
        actor,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVOICE_NOT_READY_TO_VOID' }) });
    expect(provider.cancelInvoice).toHaveBeenCalledTimes(1);

    provider.queryInvoice.mockResolvedValue({
      status: 'found',
      serviceId: invoice.externalServiceId,
      invoiceNumber: invoice.trackingNo,
      tracking: { status: 'canceled' },
    });
    await db
      .update(wmsTables.invoiceOperations)
      .set({ nextRetryAt: new Date(0) })
      .where(eq(wmsTables.invoiceOperations.id, voidOperation.operationId));
    await orchestrator.processOperation(voidOperation.operationId);
    const [recoveredVoid] = await db
      .select()
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.id, voidOperation.operationId));
    expect(provider.queryInvoice).toHaveBeenCalledTimes(1);
    expect(provider.cancelInvoice).toHaveBeenCalledTimes(1);
    expect(recoveredVoid.status).toBe('succeeded');
    expect(resumePending).toHaveBeenCalledWith(consolidationId, expect.anything());
  });

  it('leases due operations without duplicate ownership under concurrent workers', async () => {
    const leaseTestMarker = 'invoice-orchestrator.integration:skip-locked';
    // This spec intentionally commits to exercise independent worker transactions. Park
    // only leftovers owned by an earlier invocation of this exact test.
    await db.execute(sql`
      UPDATE invoice_operations
         SET next_retry_at = NOW() + INTERVAL '1 hour'
       WHERE provider_request #>> '{commandContext,note}' = ${leaseTestMarker}
         AND ((status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
           OR (status = 'recovery_required' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
           OR (status = 'in_progress' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW()))
    `);
    const [leftFixture, rightFixture] = await Promise.all([committedPlannedFixture(), committedPlannedFixture()]);
    const { orchestrator } = services();
    const [left, right] = await Promise.all([
      orchestrator.issueForShipment(
        leftFixture.shipment.shipmentId,
        { ...issueRequest(leftFixture.shipment.manifestVersion), note: leaseTestMarker },
        `invoice-lease-left-${randomUUID()}`,
        actor,
      ),
      orchestrator.issueForShipment(
        rightFixture.shipment.shipmentId,
        { ...issueRequest(rightFixture.shipment.manifestVersion), note: leaseTestMarker },
        `invoice-lease-right-${randomUUID()}`,
        actor,
      ),
    ]);
    await db
      .update(wmsTables.invoiceOperations)
      .set({ createdAt: new Date(0) })
      .where(inArray(wmsTables.invoiceOperations.id, [left.operationId, right.operationId]));

    const leased = (await Promise.all([orchestrator.leaseDueOperations(1), orchestrator.leaseDueOperations(1)])).flat();

    expect(leased).toHaveLength(2);
    expect(new Set(leased)).toEqual(new Set([left.operationId, right.operationId]));
    const rows = await db
      .select({ id: wmsTables.invoiceOperations.id, status: wmsTables.invoiceOperations.status })
      .from(wmsTables.invoiceOperations)
      .where(inArray(wmsTables.invoiceOperations.id, leased));
    expect(rows.every((row) => row.status === 'in_progress')).toBe(true);
    await Promise.all(leased.map((operationId) => orchestrator.processLeasedOperation(operationId)));
  });
});
