import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
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
import { canonicalShipmentRecipientHash, InvoiceOrchestrator } from './invoice-orchestrator.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from './shipment-planning.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const RECIPIENT = {
  recipientName: 'Outbound Batch Integration',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul integration road 1',
  detailAddress: '101',
};

type Database = PostgresJsDatabase<typeof wmsSchema>;
type WarehouseFixture = { warehouseId: string; locationId: string };

describeIfDb('OutboundBatchOrchestrator (DB integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let concurrentClient: postgres.Sql;
  let concurrentDb: Database;
  let wired: Wired;
  let concurrentWired: Wired;
  let services: ReturnType<typeof makeServices>;
  let concurrentServices: ReturnType<typeof makeServices>;

  const master = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    ({ sql: concurrentClient, db: concurrentDb } = makeDb(DATABASE_URL as string));
    wired = wireLogistics(makeDbService(db), 'v2');
    concurrentWired = wireLogistics(makeDbService(concurrentDb), 'v2');
    services = makeServices(db, wired);
    concurrentServices = makeServices(concurrentDb, concurrentWired);
  });

  afterAll(async () => {
    await Promise.all([client.end(), concurrentClient.end()]);
  });

  function fakeProvider() {
    return {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: false, lookupByServiceId: true },
      },
      issueInvoice: jest.fn(),
      cancelInvoice: jest.fn(),
      queryInvoice: jest.fn(),
    };
  }

  function makeServices(database: Database, logistics: Wired, auditOverride?: AuditService) {
    const dbService = makeDbService(database);
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const audit = auditOverride ?? new AuditService(dbService);
    const workflowGate = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const planning = new ShipmentPlanningService(
      dbService,
      commands,
      logistics.shipmentReservations,
      invariant,
      audit,
      { getScopesByRoles: () => Promise.resolve(new Set([FULFILLMENT_SCOPE.SHIPMENT_REOPEN])) } as never,
      workflowGate,
    );
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === ShipmentPlanningService) return planning;
        return { resumePending: jest.fn().mockResolvedValue(undefined) };
      }),
    };
    const provider = fakeProvider();
    const invoices = new InvoiceOrchestrator(
      dbService,
      commands,
      invariant,
      audit,
      provider as never,
      provider as never,
      workflowGate,
      moduleRef as never,
    );
    const batches = new OutboundBatchOrchestrator(
      dbService,
      commands,
      invariant,
      invoices,
      audit,
      workflowGate,
      moduleRef as never,
    );
    return { batches, planning, invoices, commands, invariant, audit, moduleRef };
  }

  async function eligibleFixture(tx: DbTx, options: { quantity?: number; warehouse?: WarehouseFixture } = {}) {
    const quantity = options.quantity ?? 2;
    const warehouse = options.warehouse ?? (await seedWarehouseWithZone(tx));
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `batch-profile-${randomUUID()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Batch Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId: warehouse.warehouseId,
      locationId: warehouse.locationId,
      stockState: 'ON_HAND',
      qty: quantity,
    });

    const variantId = randomUUID();
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: RECIPIENT })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    await seedMatching(tx, { variantId, skuId });
    await wired.fulfillments.create({ salesOrderId, warehouseId: warehouse.warehouseId }, tx);

    const [fulfillmentOrder] = await tx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    const [line] = await tx
      .select({ line: wmsTables.shipmentLines, item: wmsTables.fulfillmentOrderItems })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrder.id));
    const [shipmentBeforePlan] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, line.line.shipmentId));

    await services.planning.plan(
      shipmentBeforePlan.id,
      {
        shippingProfileId: profile.id,
        expectedManifestVersion: shipmentBeforePlan.manifestVersion,
        expectedReservationVersion: shipmentBeforePlan.reservationVersion,
      },
      `batch-plan-${randomUUID()}`,
      master,
      tx,
    );
    const [shipment] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, shipmentBeforePlan.id));
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `batch-tracking-${randomUUID()}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `batch-service-${randomUUID()}`,
        issuedForFulfillmentOrderId: fulfillmentOrder.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(shipment.recipientSnapshot),
        status: 'issued',
      })
      .returning();
    const reservations = await tx
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, line.line.id));

    expect(shipment).toMatchObject({ status: 'planned', shippingProfileId: profile.id });
    expect(reservations).toEqual([
      expect.objectContaining({ status: 'confirmed', quantity, shipmentLineId: line.line.id }),
    ]);
    return {
      ...warehouse,
      skuId,
      profile,
      salesOrderId,
      salesOrderLineId: lineIds[0],
      fulfillmentOrder,
      item: line.item,
      line: line.line,
      shipment,
      invoice,
      reservations,
    };
  }

  async function committedFixture(options: { quantity?: number; warehouse?: WarehouseFixture } = {}) {
    return db.transaction((tx) => eligibleFixture(tx as unknown as DbTx, options));
  }

  async function createBatch(warehouseId: string, orchestrator = services.batches, actor = master) {
    return orchestrator.createBatch(
      { warehouseId, pickingMethod: 'individual', name: `Integration batch ${randomUUID()}` },
      `batch-create-${randomUUID()}`,
      actor,
    );
  }

  function conflictCode(error: unknown): string | undefined {
    if (!(error instanceof ConflictException)) return undefined;
    const response = error.getResponse();
    return typeof response === 'object' && response !== null ? (response as { code?: string }).code : undefined;
  }

  it('creates, adds, and replays a batch using real reservation, profile, recipient, and invoice eligibility', async () => {
    const fixture = await committedFixture({ quantity: 3 });
    const createKey = `batch-create-replay-${randomUUID()}`;
    const createRequest = {
      warehouseId: fixture.warehouseId,
      pickingMethod: 'individual' as const,
      name: `Replay batch ${randomUUID()}`,
    };
    const created = await services.batches.createBatch(createRequest, createKey, master);
    const createReplay = await services.batches.createBatch(createRequest, createKey, master);
    expect(createReplay).toEqual(created);
    await expect(
      services.batches.createBatch({ ...createRequest, name: 'changed request' }, createKey, master),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' }) });

    const eligible = await services.batches.getEligibleShipments(created.batchId);
    expect(eligible).toContainEqual(
      expect.objectContaining({
        shipmentId: fixture.shipment.id,
        shippingProfileId: fixture.profile.id,
        invoiceId: fixture.invoice.id,
        totalQty: 3,
      }),
    );

    const addKey = `batch-add-replay-${randomUUID()}`;
    const added = await services.batches.addShipment(created.batchId, fixture.shipment.id, addKey, master);
    const replay = await services.batches.addShipment(created.batchId, fixture.shipment.id, addKey, master);
    expect(replay.operationId).toBe(added.operationId);
    expect(replay.workItem.id).toBe(added.workItem.id);
    expect(added.workItem).toMatchObject({ status: 'queued', leaseVersion: 0 });
    await expect(services.batches.addShipment(created.batchId, randomUUID(), addKey, master)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' }),
    });

    const detail = await services.batches.getBatch(created.batchId);
    expect(detail).toMatchObject({ status: 'created', totalItems: 1, totalQty: 3 });
    const [storedBatch] = await db
      .select({ status: wmsTables.outboundBatches.status })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, created.batchId));
    expect(storedBatch).toEqual({ status: 'created' });
    // Task 25 contract: FO↔batch 링크 테이블(fulfillment_order_batches)과 fulfillmentOrders.batchId,
    // outbound_batches.totalItems/totalQty 컬럼은 제거됨 — batch 단위는 FO 가 아니라 shipment(work item)다.

    await services.batches.claimPicker(
      added.workItem.id,
      { expectedLeaseVersion: 0 },
      `compatibility-claim-${randomUUID()}`,
      { id: randomUUID(), roles: ['warehouse_worker'] },
    );
    const [storedAfterClaim] = await db
      .select({ status: wmsTables.outboundBatches.status })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, created.batchId));
    expect(storedAfterClaim).toEqual({ status: 'created' });
  });

  it('allows a recalled dispatch history through batch add and exclusion while preserving the old attempt', async () => {
    const fixture = await committedFixture({ quantity: 2 });
    const attemptId = randomUUID();
    const [dispatchJournal] = await db
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
        sourceId: attemptId,
        idempotencyKey: `history-${randomUUID()}`,
      })
      .returning();
    const [reversalJournal] = await db
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_RECALL',
        sourceId: randomUUID(),
        idempotencyKey: `history-recall-${randomUUID()}`,
      })
      .returning();
    const dispatchedAt = new Date('2026-07-15T00:00:00.000Z');
    const [attempt] = await db
      .insert(wmsTables.dispatchAttempts)
      .values({
        id: attemptId,
        shipmentId: fixture.shipment.id,
        attemptNo: 1,
        status: 'recalled',
        idempotencyKey: `history-attempt-${randomUUID()}`,
        stockJournalId: dispatchJournal.id,
        reversalJournalId: reversalJournal.id,
        dispatchedAt,
        recalledAt: new Date('2026-07-15T01:00:00.000Z'),
      })
      .returning();
    const [shipEvent] = await db
      .insert(wmsTables.stockEvents)
      .values({
        journalId: dispatchJournal.id,
        skuId: fixture.skuId,
        fromWarehouseId: fixture.warehouseId,
        fromLocationId: fixture.locationId,
        fromState: 'ON_HAND',
        transitionType: 'SHIP',
        quantity: fixture.line.qty,
        occurredAt: dispatchedAt,
        idempotencyKey: `history-event-${randomUUID()}`,
        eventStatus: 'POSTED',
      })
      .returning();
    const [source] = await db
      .insert(wmsTables.dispatchAttemptSources)
      .values({
        dispatchAttemptId: attempt.id,
        shipmentLineId: fixture.line.id,
        sourceLocationId: fixture.locationId,
        qty: fixture.line.qty,
        stockEventId: shipEvent.id,
      })
      .returning();
    const batch = await createBatch(fixture.warehouseId);

    const added = await services.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `recalled-add-${randomUUID()}`,
      master,
    );
    const excluded = await services.batches.excludeShipment(
      batch.batchId,
      fixture.shipment.id,
      { reason: 'replan elsewhere' },
      `recalled-exclude-${randomUUID()}`,
      master,
    );

    expect(added.workItem.status).toBe('queued');
    expect(excluded.workItem.status).toBe('excluded');
    const [attemptAfter] = await db
      .select()
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, attempt.id));
    const [sourceAfter] = await db
      .select()
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, source.id));
    expect(attemptAfter).toEqual(attempt);
    expect(sourceAfter).toEqual(source);
  });

  it('rejects a shipment from the wrong warehouse before creating a work item', async () => {
    const fixture = await committedFixture();
    const otherWarehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const batch = await createBatch(otherWarehouse.warehouseId);

    await expect(
      services.batches.addShipment(batch.batchId, fixture.shipment.id, `wrong-warehouse-${randomUUID()}`, master),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SHIPMENT_WRONG_WAREHOUSE' }) });
    const items = await services.batches.getWorkItems(batch.batchId);
    expect(items).toHaveLength(0);
  });

  it('rejects partial or mismatched reservations, SKU profile drift, stale invoice, and existing dispatch', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const otherWarehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const partial = await committedFixture({ quantity: 2, warehouse });
    const reservationMismatch = await committedFixture({ quantity: 2, warehouse });
    const profileDrift = await committedFixture({ quantity: 2, warehouse });
    const staleInvoice = await committedFixture({ quantity: 2, warehouse });
    const dispatched = await committedFixture({ quantity: 2, warehouse });
    const batch = await createBatch(warehouse.warehouseId);

    await db
      .update(wmsTables.stockReservations)
      .set({ quantity: 1 })
      .where(eq(wmsTables.stockReservations.id, partial.reservations[0].id));
    await db
      .update(wmsTables.stockReservations)
      .set({ warehouseId: otherWarehouse.warehouseId })
      .where(eq(wmsTables.stockReservations.id, reservationMismatch.reservations[0].id));
    await db.update(wmsTables.skus).set({ deliveryProfileId: null }).where(eq(wmsTables.skus.id, profileDrift.skuId));
    await db
      .update(wmsTables.invoices)
      .set({ recipientHash: 'f'.repeat(64) })
      .where(eq(wmsTables.invoices.id, staleInvoice.invoice.id));
    await db.insert(wmsTables.dispatchAttempts).values({
      shipmentId: dispatched.shipment.id,
      attemptNo: 1,
      idempotencyKey: `eligibility-dispatch-${randomUUID()}`,
      status: 'pending',
    });

    const cases = [
      { fixture: partial, code: 'FULFILLMENT_INVARIANT_VIOLATION', key: 'partial' },
      {
        fixture: reservationMismatch,
        code: 'SHIPMENT_RESERVATION_IDENTITY_MISMATCH',
        key: 'reservation-identity',
      },
      { fixture: profileDrift, code: 'SHIPMENT_PROFILE_INCOMPATIBLE', key: 'profile' },
      { fixture: staleInvoice, code: 'SHIPMENT_INVOICE_STALE', key: 'invoice' },
      { fixture: dispatched, code: 'SHIPMENT_DISPATCH_EXISTS', key: 'dispatch' },
    ];
    for (const testCase of cases) {
      await expect(
        services.batches.addShipment(
          batch.batchId,
          testCase.fixture.shipment.id,
          `eligibility-${testCase.key}-${randomUUID()}`,
          master,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: testCase.code }) });
    }
    expect(await services.batches.getWorkItems(batch.batchId)).toHaveLength(0);
    expect(await services.batches.getEligibleShipments(batch.batchId)).toHaveLength(0);
  });

  it('translates the PostgreSQL active-work-item unique race into a domain conflict', async () => {
    const fixture = await committedFixture();
    const heldBatch = await createBatch(fixture.warehouseId);
    const competingBatch = await createBatch(fixture.warehouseId, concurrentServices.batches);
    let release!: () => void;
    let inserted!: () => void;
    const releaseGate = new Promise<void>((resolve) => (release = resolve));
    const insertedGate = new Promise<void>((resolve) => (inserted = resolve));

    const holder = db.transaction(async (tx) => {
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: heldBatch.batchId,
        shipmentId: fixture.shipment.id,
        status: 'queued',
      });
      inserted();
      await releaseGate;
    });
    await insertedGate;
    const contender = concurrentServices.batches.addShipment(
      competingBatch.batchId,
      fixture.shipment.id,
      `duplicate-race-${randomUUID()}`,
      master,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await holder;

    let error: unknown;
    try {
      await contender;
    } catch (caught) {
      error = caught;
    }
    expect(conflictCode(error)).toBe('SHIPMENT_ACTIVE_WORK_ITEM');
    const rows = await db
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, fixture.shipment.id));
    expect(rows).toHaveLength(1);
  });

  it('allows only one of two workers to win the same CAS claim on separate connections', async () => {
    const fixture = await committedFixture();
    const batch = await createBatch(fixture.warehouseId);
    const added = await services.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `claim-race-add-${randomUUID()}`,
      master,
    );
    const workerA = { id: randomUUID(), roles: ['warehouse_worker'] };
    const workerB = { id: randomUUID(), roles: ['warehouse_worker'] };

    const results = await Promise.allSettled([
      services.batches.claimPicker(
        added.workItem.id,
        { expectedLeaseVersion: 0 },
        `claim-race-a-${randomUUID()}`,
        workerA,
      ),
      concurrentServices.batches.claimPicker(
        added.workItem.id,
        { expectedLeaseVersion: 0 },
        `claim-race-b-${randomUUID()}`,
        workerB,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(conflictCode(rejected?.reason)).toBe('WORK_ITEM_STALE_LEASE_VERSION');

    const [stored] = await db
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    expect(stored).toMatchObject({ status: 'picking', leaseVersion: 1 });
    expect([workerA.id, workerB.id]).toContain(stored.pickerId);
  });

  it('reclaims an expired lease using an expiry timestamp produced by PostgreSQL time', async () => {
    const fixture = await committedFixture();
    const batch = await createBatch(fixture.warehouseId);
    const added = await services.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `expiry-add-${randomUUID()}`,
      master,
    );
    const firstWorker = { id: randomUUID(), roles: ['warehouse_worker'] };
    const nextWorker = { id: randomUUID(), roles: ['warehouse_worker'] };
    const claimed = await services.batches.claimPicker(
      added.workItem.id,
      { expectedLeaseVersion: 0 },
      `expiry-first-${randomUUID()}`,
      firstWorker,
    );
    await db.execute(sql`
      UPDATE outbound_batch_work_items
         SET lease_expires_at = transaction_timestamp() - interval '1 second'
       WHERE id = ${added.workItem.id}::uuid
    `);

    const reclaimed = await concurrentServices.batches.claimPicker(
      added.workItem.id,
      { expectedLeaseVersion: claimed.workItem.leaseVersion },
      `expiry-reclaim-${randomUUID()}`,
      nextWorker,
    );
    expect(reclaimed.workItem).toMatchObject({
      status: 'picking',
      pickerId: nextWorker.id,
      leaseVersion: claimed.workItem.leaseVersion + 1,
    });
    expect(reclaimed.workItem.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    await expect(
      services.batches.claimPicker(
        added.workItem.id,
        { expectedLeaseVersion: claimed.workItem.leaseVersion },
        `expiry-stale-${randomUUID()}`,
        firstWorker,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORK_ITEM_STALE_LEASE_VERSION' }) });
  });

  it('replays manager handoff, rejects a target with another active claim, and forbids worker-directed handoff', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const [fixtureA, fixtureB] = await Promise.all([committedFixture({ warehouse }), committedFixture({ warehouse })]);
    const batch = await createBatch(warehouse.warehouseId);
    const [addedA, addedB] = await Promise.all([
      services.batches.addShipment(batch.batchId, fixtureA.shipment.id, `handoff-add-a-${randomUUID()}`, master),
      services.batches.addShipment(batch.batchId, fixtureB.shipment.id, `handoff-add-b-${randomUUID()}`, master),
    ]);
    const owner = { id: randomUUID(), roles: ['warehouse_worker'] };
    const busyTarget = { id: randomUUID(), roles: ['warehouse_worker'] };
    const freeTargetId = randomUUID();
    const [ownerClaim, busyClaim] = await Promise.all([
      services.batches.claimPicker(
        addedA.workItem.id,
        { expectedLeaseVersion: 0 },
        `handoff-owner-${randomUUID()}`,
        owner,
      ),
      services.batches.claimPicker(
        addedB.workItem.id,
        { expectedLeaseVersion: 0 },
        `handoff-busy-${randomUUID()}`,
        busyTarget,
      ),
    ]);

    await expect(
      services.batches.handoff(
        addedA.workItem.id,
        {
          claimType: 'picker',
          targetWorkerId: busyTarget.id,
          expectedLeaseVersion: ownerClaim.workItem.leaseVersion,
          reason: 'target already busy',
        },
        `handoff-busy-target-${randomUUID()}`,
        master,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORKER_ACTIVE_CLAIM_EXISTS' }) });

    const handoffKey = `handoff-replay-${randomUUID()}`;
    const request = {
      claimType: 'picker' as const,
      targetWorkerId: freeTargetId,
      expectedLeaseVersion: ownerClaim.workItem.leaseVersion,
      reason: 'shift handoff',
    };
    const handedOff = await services.batches.handoff(addedA.workItem.id, request, handoffKey, master);
    const replay = await services.batches.handoff(addedA.workItem.id, request, handoffKey, master);
    expect(replay.operationId).toBe(handedOff.operationId);
    expect(replay.workItem).toMatchObject({ pickerId: freeTargetId, leaseVersion: 2 });

    await expect(
      services.batches.handoff(
        addedA.workItem.id,
        {
          claimType: 'picker',
          targetWorkerId: randomUUID(),
          expectedLeaseVersion: handedOff.workItem.leaseVersion,
          reason: 'worker cannot direct handoff',
        },
        `handoff-forbidden-${randomUUID()}`,
        owner,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(busyClaim.workItem.pickerId).toBe(busyTarget.id);
  });

  it('derives batch state from work items without treating short-pick recovery or all-excluded as completed', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const [fixtureA, fixtureB] = await Promise.all([committedFixture({ warehouse }), committedFixture({ warehouse })]);
    const batch = await createBatch(warehouse.warehouseId);
    const [addedA, addedB] = await Promise.all([
      services.batches.addShipment(batch.batchId, fixtureA.shipment.id, `status-add-a-${randomUUID()}`, master),
      services.batches.addShipment(batch.batchId, fixtureB.shipment.id, `status-add-b-${randomUUID()}`, master),
    ]);
    await db
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'short_pick_recovery', recoveryReason: 'one unit missing' })
      .where(eq(wmsTables.outboundBatchWorkItems.id, addedA.workItem.id));
    await db
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'excluded', exclusionReason: 'remove unaffected shipment' })
      .where(eq(wmsTables.outboundBatchWorkItems.id, addedB.workItem.id));
    expect(await services.batches.getBatch(batch.batchId)).toMatchObject({ status: 'picking', totalItems: 1 });

    await db
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'excluded', exclusionReason: 'short pick cannot complete batch' })
      .where(eq(wmsTables.outboundBatchWorkItems.id, addedA.workItem.id));
    expect(await services.batches.getBatch(batch.batchId)).toMatchObject({
      status: 'created',
      totalItems: 0,
      totalQty: 0,
    });
  });

  it('rejects new membership when the derived work-item state has completed the batch', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const fixtureA = await committedFixture({ warehouse });
    const fixtureB = await committedFixture({ warehouse });
    const batch = await createBatch(warehouse.warehouseId);
    const added = await services.batches.addShipment(
      batch.batchId,
      fixtureA.shipment.id,
      `closed-add-a-${randomUUID()}`,
      master,
    );
    await db
      .update(wmsTables.outboundBatchWorkItems)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    expect(await services.batches.getBatch(batch.batchId)).toMatchObject({
      status: 'completed',
      totalItems: 1,
      totalQty: expect.any(Number),
    });
    expect(await services.batches.listBatches({ status: 'completed' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: batch.batchId,
          status: 'completed',
          totalItems: 1,
          totalQty: expect.any(Number),
        }),
      ]),
    );
    expect((await services.batches.listBatches({ status: 'created' })).map((row) => row.id)).not.toContain(
      batch.batchId,
    );

    await expect(
      services.batches.addShipment(batch.batchId, fixtureB.shipment.id, `closed-add-b-${randomUUID()}`, master),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'OUTBOUND_BATCH_CLOSED' }) });
  });

  it('preserves reservations on exclusion and blocks exclusion when custody or dispatch exists', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const [preserved, withCustody, withDispatch] = await Promise.all([
      committedFixture({ quantity: 2, warehouse }),
      committedFixture({ quantity: 2, warehouse }),
      committedFixture({ quantity: 2, warehouse }),
    ]);
    const batch = await createBatch(warehouse.warehouseId);
    const [preservedItem, custodyItem, dispatchItem] = await Promise.all([
      services.batches.addShipment(batch.batchId, preserved.shipment.id, `exclude-add-a-${randomUUID()}`, master),
      services.batches.addShipment(batch.batchId, withCustody.shipment.id, `exclude-add-b-${randomUUID()}`, master),
      services.batches.addShipment(batch.batchId, withDispatch.shipment.id, `exclude-add-c-${randomUUID()}`, master),
    ]);
    const before = await db
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, preserved.line.id));
    const excluded = await services.batches.excludeShipment(
      batch.batchId,
      preserved.shipment.id,
      { reason: 'operator exclusion' },
      `exclude-preserve-${randomUUID()}`,
      master,
    );
    const after = await db
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, preserved.line.id));
    expect(excluded.workItem).toMatchObject({ id: preservedItem.workItem.id, status: 'excluded' });
    expect(after).toEqual(before);

    const [session] = await db
      .insert(wmsTables.batchInventorySessions)
      .values({ batchId: batch.batchId, handedInQty: 1 })
      .returning();
    await db.insert(wmsTables.batchInventorySessionBalances).values({
      sessionId: session.id,
      skuId: withCustody.skuId,
      sourceLocationId: withCustody.locationId,
      custodyType: 'WORKER',
      custodyRef: randomUUID(),
      shipmentLineId: withCustody.line.id,
      qty: 1,
    });
    await expect(
      services.batches.excludeShipment(
        batch.batchId,
        withCustody.shipment.id,
        { reason: 'must unpick first' },
        `exclude-custody-${randomUUID()}`,
        master,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORK_ITEM_UNPICK_REQUIRED' }) });

    await db.insert(wmsTables.dispatchAttempts).values({
      shipmentId: withDispatch.shipment.id,
      attemptNo: 1,
      idempotencyKey: `exclude-dispatch-${randomUUID()}`,
      status: 'pending',
    });
    await expect(
      services.batches.excludeShipment(
        batch.batchId,
        withDispatch.shipment.id,
        { reason: 'dispatch already began' },
        `exclude-dispatched-${randomUUID()}`,
        master,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORK_ITEM_DISPATCH_EXISTS' }) });
    expect(custodyItem.workItem.status).toBe('queued');
    expect(dispatchItem.workItem.status).toBe('queued');
  });

  it('rolls the command and domain row back when mandatory audit persistence fails', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const auditFailure = {
      logUserActionRequired: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    } as unknown as AuditService;
    const failing = makeServices(db, wired, auditFailure);
    const key = `audit-rollback-${randomUUID()}`;

    await expect(
      failing.batches.createBatch(
        { warehouseId: warehouse.warehouseId, pickingMethod: 'individual', name: key },
        key,
        master,
      ),
    ).rejects.toThrow('audit unavailable');
    const [command, batch] = await Promise.all([
      db
        .select({ id: wmsTables.fulfillmentCommandRequests.id })
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key)),
      db
        .select({ id: wmsTables.outboundBatches.id })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.name, key)),
    ]);
    expect(command).toHaveLength(0);
    expect(batch).toHaveLength(0);
  });

  it('rejects a foreign waiting operation without excluding or replacing the work item', async () => {
    const warehouse = await db.transaction((tx) => seedWarehouseWithZone(tx as unknown as DbTx));
    const [fixture, foreign] = await Promise.all([committedFixture({ warehouse }), committedFixture({ warehouse })]);
    const batch = await createBatch(warehouse.warehouseId);
    const added = await services.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `foreign-wait-add-${randomUUID()}`,
      master,
    );
    const operationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(wmsTables.shipmentOperations).values({
        id: operationId,
        type: 'cancel',
        status: 'pending',
        operatorId: master.id,
        reason: 'belongs to another shipment',
        idempotencyKey: `foreign-wait-${randomUUID()}`,
        requestHash: '0'.repeat(64),
      });
      await tx.insert(wmsTables.shipmentOperationMembers).values({
        operationId,
        shipmentId: foreign.shipment.id,
        role: 'source',
        beforeManifestVersion: foreign.shipment.manifestVersion,
      });
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ waitingOperationId: operationId })
        .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    });

    await expect(
      services.batches.excludeShipment(
        batch.batchId,
        fixture.shipment.id,
        { reason: 'must not resume foreign work' },
        `foreign-wait-exclude-${randomUUID()}`,
        master,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'WORK_ITEM_WAITING_OPERATION_CONFLICT' }) });
    const [stored] = await db
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    expect(stored).toMatchObject({ status: 'queued', waitingOperationId: operationId });
  });

  it('stores a pending cancellation on the work item and resumes that exact operation after exclusion commits', async () => {
    const fixture = await committedFixture({ quantity: 2 });
    const batch = await createBatch(fixture.warehouseId);
    const added = await services.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `resume-add-${randomUUID()}`,
      master,
    );
    const cancellation = await services.planning.cancelOutstanding(
      fixture.shipment.id,
      {
        expectedManifestVersion: fixture.shipment.manifestVersion,
        reason: 'remove one item after label void',
        lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
      },
      `resume-cancel-${randomUUID()}`,
      master,
    );
    expect(cancellation.operationStatus).toBe('pending');
    const [waiting] = await db
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    expect(waiting.waitingOperationId).toBe(cancellation.operationId);

    await db
      .update(wmsTables.invoices)
      .set({ status: 'voided', voidedAt: new Date() })
      .where(eq(wmsTables.invoices.id, fixture.invoice.id));
    const excluded = await services.batches.excludeShipment(
      batch.batchId,
      fixture.shipment.id,
      { reason: 'invoice void completed' },
      `resume-exclude-${randomUUID()}`,
      master,
    );
    expect(excluded.workItem).toMatchObject({ status: 'excluded', waitingOperationId: cancellation.operationId });

    const [[operation], [line], reservations] = await Promise.all([
      db
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, cancellation.operationId)),
      db.select().from(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, fixture.line.id)),
      db
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id)),
    ]);
    expect(operation).toMatchObject({ id: cancellation.operationId, type: 'cancel', status: 'completed' });
    expect(line.qty).toBe(1);
    expect(reservations).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'confirmed', quantity: 1 })]),
    );
    expect(
      reservations
        .filter((reservation) => reservation.status === 'confirmed')
        .reduce((total, reservation) => total + reservation.quantity, 0),
    ).toBe(1);
    expect(services.moduleRef.get).toHaveBeenCalledWith(ShipmentPlanningService, { strict: false });
  });

  it('serializes add against cancellation without leaving an uncorrelated active work item', async () => {
    const fixture = await committedFixture({ quantity: 2 });
    const batch = await createBatch(fixture.warehouseId);
    const add = concurrentServices.batches.addShipment(
      batch.batchId,
      fixture.shipment.id,
      `serialize-add-${randomUUID()}`,
      master,
    );
    const cancellationKey = `serialize-cancel-${randomUUID()}`;
    const cancellation = services.planning.cancelOutstanding(
      fixture.shipment.id,
      {
        expectedManifestVersion: fixture.shipment.manifestVersion,
        reason: 'concurrent order correction',
        lines: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 1 }],
      },
      cancellationKey,
      master,
    );
    const [addResult, cancelResult] = await Promise.allSettled([add, cancellation]);
    expect(cancelResult.status).toBe('fulfilled');
    if (addResult.status === 'rejected') {
      expect(['SHIPMENT_NOT_PLANNED', 'SHIPMENT_ACTIVE_WORK_ITEM']).toContain(conflictCode(addResult.reason));
    }

    const cancellationResult = (cancelResult as PromiseFulfilledResult<{ operationId: string }>).value;
    const [operation] = await db
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, cancellationResult.operationId));
    expect(operation).toMatchObject({ idempotencyKey: cancellationKey, type: 'cancel', status: 'pending' });
    const workItems = await db
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, fixture.shipment.id),
          eq(wmsTables.outboundBatchWorkItems.batchId, batch.batchId),
        ),
      );
    if (workItems.length) {
      expect(workItems).toHaveLength(1);
      expect(workItems[0].waitingOperationId).toBe(cancellationResult.operationId);
    }
  });
});
