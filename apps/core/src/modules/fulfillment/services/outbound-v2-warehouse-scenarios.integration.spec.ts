import { outbox_events } from '@app/events';
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { PickingStrategyName } from '../picking/picking-strategy.interface';
import { inRollbackTx, makeDb } from './__support__';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import {
  aggregatePick,
  createBatchWithShipments,
  Database,
  discretePickAfterHandoff,
  makeServices,
  seedRegisteredWaybill,
  seedRegisteredWaybills,
  seedWorld,
  totePick,
  WarehouseWorld,
} from './__support__/outbound-v2-warehouse-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
describeIfDb('Outbound V2 warehouse release scenarios 06-10', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  async function expectCoreCheckpoint(
    tx: DbTx,
    world: WarehouseWorld,
    expected: { onHandQty: number; reservedQty: number; availableQty: number } = {
      onHandQty: world.stockQty,
      reservedQty: world.stockQty,
      availableQty: 0,
    },
  ) {
    await new FulfillmentInvariantService().assertFulfillmentOrders(
      world.shipments.map((member) => member.fulfillmentOrder.id),
      tx,
    );
    const foi = await tx
      .select({ qty: wmsTables.fulfillmentOrderItems.qty, reservedQty: wmsTables.fulfillmentOrderItems.reservedQty })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        inArray(
          wmsTables.fulfillmentOrderItems.id,
          world.shipments.map((member) => member.item.id),
        ),
      );
    const reservations = await tx
      .select({ quantity: wmsTables.stockReservations.quantity, status: wmsTables.stockReservations.status })
      .from(wmsTables.stockReservations)
      .where(
        inArray(
          wmsTables.stockReservations.shipmentLineId,
          world.shipments.map((member) => member.line.id),
        ),
      );
    const [ledger] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, world.skuId),
          eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    expect(foi.reduce((sum, item) => sum + item.qty, 0)).toBe(
      world.shipments.reduce((sum, member) => sum + member.line.qty, 0),
    );
    expect(reservations.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + row.quantity, 0)).toBe(
      foi.reduce((sum, item) => sum + item.reservedQty, 0),
    );
    const reservedQty = reservations
      .filter((row) => row.status === 'confirmed')
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(ledger.qty).toBe(expected.onHandQty);
    expect(reservedQty).toBe(expected.reservedQty);
    expect(ledger.qty - reservedQty).toBe(expected.availableQty);
  }

  async function expectArtifactCardinality(
    tx: DbTx,
    world: WarehouseWorld,
    expected: {
      attempts?: number;
      sources?: number;
      shipStockEvents?: number;
      shipmentOutbox?: number;
      fulfillmentV2Outbox?: number;
      fulfillmentV1Outbox?: number;
      inventoryOutbox?: number;
      fullyShippedFulfillmentOrderIds?: string[];
    } = {},
  ) {
    const shipmentIds = world.shipments.map((member) => member.shipment.id);
    const attempts = await tx
      .select({ id: wmsTables.dispatchAttempts.id, shipmentId: wmsTables.dispatchAttempts.shipmentId })
      .from(wmsTables.dispatchAttempts)
      .where(inArray(wmsTables.dispatchAttempts.shipmentId, shipmentIds));
    const sources = attempts.length
      ? await tx
          .select({ stockEventId: wmsTables.dispatchAttemptSources.stockEventId })
          .from(wmsTables.dispatchAttemptSources)
          .where(
            inArray(
              wmsTables.dispatchAttemptSources.dispatchAttemptId,
              attempts.map((attempt) => attempt.id),
            ),
          )
      : [];
    const shipStockEvents = sources.length
      ? await tx
          .select({ id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(
            and(
              inArray(
                wmsTables.stockEvents.id,
                sources.flatMap((source) => (source.stockEventId ? [source.stockEventId] : [])),
              ),
              eq(wmsTables.stockEvents.transitionType, 'SHIP'),
            ),
          )
      : [];
    const outbox = await tx
      .select({
        topic: outbox_events.topic,
        eventType: outbox_events.eventType,
        aggregateType: outbox_events.aggregateType,
        aggregateId: outbox_events.aggregateId,
        idempotencyKey: outbox_events.idempotencyKey,
      })
      .from(outbox_events)
      .where(
        inArray(outbox_events.aggregateId, [
          ...shipmentIds,
          ...world.shipments.map((member) => member.fulfillmentOrder.id),
          ...shipStockEvents.map((event) => event.id),
        ]),
      );
    expect(attempts).toHaveLength(expected.attempts ?? 0);
    expect(sources).toHaveLength(expected.sources ?? 0);
    expect(shipStockEvents).toHaveLength(expected.shipStockEvents ?? 0);
    const attemptOrders = attempts.length
      ? await tx
          .select({
            attemptId: wmsTables.dispatchAttempts.id,
            fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          })
          .from(wmsTables.dispatchAttempts)
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.shipmentId, wmsTables.dispatchAttempts.shipmentId),
          )
          .innerJoin(
            wmsTables.fulfillmentOrderItems,
            eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
          )
          .where(
            inArray(
              wmsTables.dispatchAttempts.id,
              attempts.map((attempt) => attempt.id),
            ),
          )
      : [];
    const expectedOutbox = [
      ...attempts.map((attempt) => ({
        topic: 'shipments.events.v1',
        eventType: 'ShipmentShipped',
        aggregateType: 'Shipment',
        aggregateId: attempt.shipmentId,
        idempotencyKey: attempt.id,
      })),
      ...attempts.flatMap((attempt) =>
        [
          ...new Set(
            attemptOrders.filter((order) => order.attemptId === attempt.id).map((order) => order.fulfillmentOrderId),
          ),
        ].map((fulfillmentOrderId) => ({
          topic: 'fulfillments.events.v2',
          eventType: 'FulfillmentProgressed',
          aggregateType: 'FulfillmentOrder',
          aggregateId: fulfillmentOrderId,
          idempotencyKey: `${attempt.id}:${fulfillmentOrderId}`,
        })),
      ),
      ...(expected.fullyShippedFulfillmentOrderIds ?? []).map((fulfillmentOrderId) => ({
        topic: 'fulfillments.events.v1',
        eventType: 'FulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: fulfillmentOrderId,
        idempotencyKey: `${fulfillmentOrderId}:fully-shipped`,
      })),
      ...shipStockEvents.map((event) => ({
        topic: 'inventory.events.v1',
        eventType: 'StockShipped',
        aggregateType: 'Stock',
        aggregateId: event.id,
        idempotencyKey: `stock-event:${event.id}`,
      })),
    ];
    const encode = (event: (typeof outbox)[number]) =>
      `${event.topic}|${event.eventType}|${event.aggregateType}|${event.aggregateId}|${event.idempotencyKey}`;
    expect(outbox.map(encode).sort()).toEqual(expectedOutbox.map(encode).sort());
    expect(outbox.filter((event) => event.topic === 'shipments.events.v1')).toHaveLength(expected.shipmentOutbox ?? 0);
    expect(outbox.filter((event) => event.topic === 'fulfillments.events.v2')).toHaveLength(
      expected.fulfillmentV2Outbox ?? 0,
    );
    expect(outbox.filter((event) => event.topic === 'fulfillments.events.v1')).toHaveLength(
      expected.fulfillmentV1Outbox ?? 0,
    );
    expect(outbox.filter((event) => event.topic === 'inventory.events.v1')).toHaveLength(expected.inventoryOutbox ?? 0);
  }

  async function expectSessionCheckpoint(
    tx: DbTx,
    sessionId: string,
    expected: {
      status: 'active' | 'settled';
      handedInQty: number;
      settledQty: number;
      returnedQty: number;
      /** 안 집은 채 돌려준 몫(결품 철회) — 없으면 0. */
      handedBackQty?: number;
      shortageQty: number;
      balanceQty: number;
    },
  ) {
    const handedBackQty = expected.handedBackQty ?? 0;
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId));
    const balances = await tx
      .select({ qty: wmsTables.batchInventorySessionBalances.qty })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    expect(session).toMatchObject({
      status: expected.status,
      handedInQty: expected.handedInQty,
      settledQty: expected.settledQty,
      returnedQty: expected.returnedQty,
      handedBackQty,
      shortageQty: expected.shortageQty,
    });
    expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(expected.balanceQty);
    expect(
      expected.settledQty + expected.returnedQty + handedBackQty + expected.shortageQty + expected.balanceQty,
    ).toBe(expected.handedInQty);
  }

  // 플랜3 컷오버: batch add 는 issued invoice 대신 WaybillService.assertDispatchable(registered waybill)를
  // 게이트한다. dispatchable waybill 이 없는 shipment 는 batch 에 진입조차 못 한다 — 그 실패가 자기 shipment 에
  // 국한되고 다른 shipment 의 등록→발송을 방해하지 않음을 고정한다(구 invoice-issue 실패 격리의 waybill 등가물).
  it('06 a shipment without a dispatchable waybill stays out of the batch while another registers and dispatches', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2, 2]);
      // shipment B(index 1)만 registered waybill 을 갖는다 — A(index 0)는 dispatchable waybill 이 없다.
      await seedRegisteredWaybill(tx, world.shipments[1].shipment.id);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };

      const successWorld = { ...world, shipments: [world.shipments[1]] };
      const { batch, added } = await createBatchWithShipments(services, successWorld, manager, 'multi_order', 4);

      // A 는 dispatchable waybill 이 없어 batch add 자체가 막힌다. WaybillService.assertDispatchable 은 @app/shared
      // ConflictError 를 던진다(Nest .response.code 아님) — message 접두사로 WAYBILL_NOT_DISPATCHABLE 를 싣는다.
      await expect(
        services.batches.addShipment(
          batch.batchId,
          world.shipments[0].shipment.id,
          `release-add-failed-${randomUUID()}`,
          manager,
        ),
      ).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const picked = await totePick(services, successWorld, batch.batchId, added[0].workItem.id, worker, [1, 1]);
      const packed = await services.batches.claimPacker(
        added[0].workItem.id,
        { expectedLeaseVersion: picked.claim.workItem.leaseVersion + 1 },
        `release-packer-${randomUUID()}`,
        worker,
      );
      for (const [index, toteId] of picked.toteIds.entries()) {
        const [tote] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, toteId));
        await services.picking.releaseTote({
          batchId: batch.batchId,
          sessionId: picked.sessionId,
          workItemId: added[0].workItem.id,
          shipmentId: world.shipments[1].shipment.id,
          toteBarcode: tote.barcode,
          actor: worker,
          expectedLeaseVersion: packed.workItem.leaseVersion,
          reason: 'packing complete',
          idempotencyKey: `release-tote-${index}-${randomUUID()}`,
        });
      }
      const dispatched = await services.dispatch.inspectionScan(world.shipments[1].shipment.id, {
        barcode: world.barcode,
        quantity: 2,
        actor: worker,
        idempotencyKey: `release-dispatch-${randomUUID()}`,
      });
      expect(packed.workItem.status).toBe('packing');
      expect(dispatched).toMatchObject({ status: 'shipped', attemptNo: 1 });

      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, world.shipments[1].shipment.id));
      const sources = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempts[0].id));
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, sources[0].stockEventId!));
      const events = await tx
        .select()
        .from(outbox_events)
        .where(eq(outbox_events.aggregateId, world.shipments[1].shipment.id));
      const [settledSession] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, picked.sessionId));
      const settledBalances = await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      // 격리 증거(waybill 등가물): A 는 dispatchable waybill 이 없어 waybill 행 자체가 없고, B 의 registered
      // waybill 은 dispatch 로 used 로 전이했다. A 의 실패는 B 의 등록→발송에 전혀 번지지 않았다.
      const waybillsA = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, world.shipments[0].shipment.id));
      const [waybillB] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, world.shipments[1].shipment.id));
      expect(waybillsA).toHaveLength(0);
      expect(waybillB).toMatchObject({ status: 'used' });
      expect(attempts).toHaveLength(1);
      expect(sources).toEqual([expect.objectContaining({ shipmentLineId: world.shipments[1].line.id, qty: 2 })]);
      expect(shipEvents).toEqual([expect.objectContaining({ transitionType: 'SHIP', quantity: 2 })]);
      expect(events.filter((event) => event.topic === 'shipments.events.v1')).toHaveLength(1);
      expect(settledSession).toMatchObject({ status: 'settled', handedInQty: 2, settledQty: 2 });
      expect(settledBalances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(2);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'settled',
        handedInQty: 2,
        settledQty: 2,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 0,
      });
      await expectCoreCheckpoint(tx, world, { onHandQty: 2, reservedQty: 2, availableQty: 0 });
      await expectArtifactCardinality(tx, world, {
        attempts: 1,
        sources: 1,
        shipStockEvents: 1,
        shipmentOutbox: 1,
        fulfillmentV2Outbox: 1,
        fulfillmentV1Outbox: 1,
        inventoryOutbox: 1,
        fullyShippedFulfillmentOrderIds: [world.shipments[1].fulfillmentOrder.id],
      });
    });
  });

  it('07 discrete multi-worker claim, manager handoff, and packer claim use the production lease workflow', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2], ['discrete']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const workerA = { id: randomUUID(), roles: ['warehouse_worker'] };
      const workerB = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager, 'individual');
      const firstClaim = await services.batches.claimPicker(
        added[0].workItem.id,
        { expectedLeaseVersion: 0 },
        `worker-a-claim-${randomUUID()}`,
        workerA,
      );
      const handoff = await services.batches.handoff(
        added[0].workItem.id,
        {
          claimType: 'picker',
          targetWorkerId: workerB.id,
          expectedLeaseVersion: firstClaim.workItem.leaseVersion,
          reason: 'shift boundary',
        },
        `worker-handoff-${randomUUID()}`,
        manager,
      );
      expect(handoff.workItem).toMatchObject({ pickerId: workerB.id, leaseVersion: 2 });

      const picked = await discretePickAfterHandoff(
        services,
        world,
        batch.batchId,
        added[0].workItem.id,
        workerB,
        handoff.workItem.leaseVersion,
      );
      const packed = await services.batches.claimPacker(
        added[0].workItem.id,
        { expectedLeaseVersion: handoff.workItem.leaseVersion + 1 },
        `worker-a-pack-${randomUUID()}`,
        workerA,
      );
      expect(packed.workItem).toMatchObject({ status: 'packing', packerId: workerA.id });
      const [stored] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[0].workItem.id));
      expect(stored).toMatchObject({ pickerId: workerB.id, packerId: workerA.id, status: 'packing' });
      const balances = await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(2);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 2,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 2,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('08 aggregate collect/sort completes with source-bucket and session quantity conservation', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [4], ['aggregate_then_sort']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager, 'total_picking');
      const picked = await aggregatePick(services, world, batch.batchId, added[0].workItem.id, worker);
      expect(picked.completed).toMatchObject({ custodyType: 'PACKING', totalQty: 4 });

      const balances = await tx
        .select({
          custodyType: wmsTables.batchInventorySessionBalances.custodyType,
          qty: wmsTables.batchInventorySessionBalances.qty,
        })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(4);
      expect(
        balances.filter((balance) => balance.custodyType === 'AT_SOURCE').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(0);
      expect(
        balances.filter((balance) => balance.custodyType === 'BULK_CART').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(0);
      expect(
        balances.filter((balance) => balance.custodyType === 'PACKING').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(4);
      const sessionEvents = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, picked.sessionId));
      expect(sessionEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['HAND_IN', 'MOVE_CUSTODY']),
      );
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 4,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 4,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('09 pick-to-tote scans one shipment across multiple physical totes and consolidates custody for packing', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [4], ['pick_to_tote']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager, 'multi_order', 4);
      const picked = await totePick(services, world, batch.batchId, added[0].workItem.id, worker, [1, 3]);
      expect(picked.completed).toMatchObject({ custodyType: 'PACKING', totalQty: 4 });
      const assignments = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.shipmentId, world.shipments[0].shipment.id));
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((assignment) => assignment.toteId))).toEqual(new Set(picked.toteIds));
      const balances = await tx
        .select({
          custodyType: wmsTables.batchInventorySessionBalances.custodyType,
          qty: wmsTables.batchInventorySessionBalances.qty,
        })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(4);
      expect(balances.filter((balance) => balance.custodyType === 'TOTE').reduce((sum, row) => sum + row.qty, 0)).toBe(
        0,
      );
      expect(
        balances.filter((balance) => balance.custodyType === 'PACKING').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(4);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 4,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 4,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('10 short pick without spare stock withdraws one shipment and preserves its sibling reservation and active work', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [5, 5], ['aggregate_then_sort']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['master', 'warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager, 'total_picking');
      const claimed = await services.batches.claimPicker(
        added[0].workItem.id,
        { expectedLeaseVersion: 0 },
        `short-pick-claim-${randomUUID()}`,
        worker,
      );
      const started = await services.picking.start({
        batchId: batch.batchId,
        actorId: worker.id,
        idempotencyKey: `short-pick-start-${randomUUID()}`,
      });
      expect(started.state).toBe('started');
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, started.sessionId));
      const [currentLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, world.shipments[0].line.id));

      const reported = await services.shortPick.report(
        world.shipments[0].shipment.id,
        {
          workItemId: added[0].workItem.id,
          expectedWorkItemLeaseVersion: claimed.workItem.leaseVersion,
          sessionId: session.id,
          expectedSessionVersion: session.version,
          expectedManifestVersion: world.shipments[0].shipment.manifestVersion,
          lines: [
            {
              shipmentLineId: currentLine.id,
              sourceLocationId: world.locationId,
              expectedLineVersion: currentLine.lineVersion,
              shortQty: 1,
            },
          ],
          reason: 'inventory_shortage',
        },
        `short-pick-report-${randomUUID()}`,
        worker,
      );
      // 플랜3: short-pick.report 는 동기 완료 — registered waybill 을 report tx 안에서 void 하고 인라인 finalize
      // 한다. 구 async invoice-void→resume(invoiceOperationId 추적) 2단계는 사라졌다.
      expect(reported).toMatchObject({
        shipmentId: world.shipments[0].shipment.id,
        operationStatus: 'completed',
        outcome: 'exited',
        workItemId: added[0].workItem.id,
      });
      expect(reported.invoiceOperationId).toBeNull();

      const reservationsA = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, world.shipments[0].line.id));
      const reservationsB = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, world.shipments[1].line.id));
      expect(reservationsA).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'confirmed', quantity: 4 }),
          expect.objectContaining({ status: 'released', quantity: 1 }),
        ]),
      );
      expect(reservationsB).toEqual([expect.objectContaining({ status: 'confirmed', quantity: 5 })]);

      // 동기 end-state: report tx 안에서 A 의 registered waybill 이 이미 voided 로 종결됐다(구 invoice void 등가물).
      const [waybillA] = await tx
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, world.shipments[0].shipment.id));
      expect(waybillA).toMatchObject({ status: 'voided' });
      expect(waybillA.voidedAt).not.toBeNull();
      const [shipmentA] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, world.shipments[0].shipment.id));
      const [shipmentB] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, world.shipments[1].shipment.id));
      const [workA] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[0].workItem.id));
      const [workB] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[1].workItem.id));
      const [sessionQuantity] = await tx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, reported.operationId));
      expect(shipmentA).toMatchObject({ status: 'draft', recoveryCode: null });
      expect(shipmentB).toMatchObject({ status: 'planned', manifestVersion: 1, reservationVersion: 1 });
      expect(workA).toMatchObject({ status: 'excluded', waitingOperationId: null });
      expect(workB).toMatchObject({ status: 'queued', leaseVersion: 0 });
      expect(Number(sessionQuantity.qty)).toBe(5);
      await expectSessionCheckpoint(tx, session.id, {
        status: 'active',
        handedInQty: 10,
        settledQty: 0,
        returnedQty: 0,
        handedBackQty: 4,
        shortageQty: 1,
        balanceQty: 5,
      });
      expect(operation).toMatchObject({ status: 'completed', lastError: null });
      await expectCoreCheckpoint(tx, world, { onHandQty: 10, reservedQty: 9, availableQty: 1 });
      await expectArtifactCardinality(tx, world);
    });
  });

  // ADR-0030 §3.5: 창고가 해당 전략을 켰는지 확인하는 검사의 소유자는
  // `PickingStrategyRegistry.resolveForWarehouse` 다 — 배치 시작은 배정 층에 들어가기 전에
  // 이걸 먼저 통과해야 한다. 아래 케이스들은 그 한 벌만으로 시작이 막히는지를
  // 실 DB 로 고정한다. 단언을 registry 쪽 메시지에 맞춘 것은 의도적이다 — 검사가
  // registry 밖으로 새어 나가거나 사라지면 여기서 깨진다.
  //
  // 배치 생성 자체가 창고 지원 여부를 게이트하므로(`OUTBOUND_BATCH_METHOD_NOT_SUPPORTED`), 미설정 창고는
  // 배치를 만든 뒤 설정을 회수해서 만든다 — 운영에서 창고 설정이 바뀌면 실제로 이 상태가 된다.
  async function revokeWarehouseStrategies(tx: DbTx, warehouseId: string, remaining: PickingStrategyName[]) {
    await tx
      .update(wmsTables.warehouses)
      .set({ supportedPickingStrategies: remaining })
      .where(eq(wmsTables.warehouses.id, warehouseId));
  }

  // `expect.stringContaining` 은 any 를 돌려줘 toMatchObject 안에 넣으면 lint 가 막는다. 잡아서
  // 좁히면 클래스와 메시지를 둘 다 타입 안전하게 고정할 수 있다.
  async function expectConflict(promise: Promise<unknown>, messagePart: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    if (!(caught instanceof ConflictException)) throw new Error('expected a ConflictException');
    expect(caught.message).toContain(messagePart);
  }

  it('refuses to start a batch on a warehouse whose picking strategy configuration was emptied', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2], ['discrete']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch } = await createBatchWithShipments(services, world, manager);
      await revokeWarehouseStrategies(tx, world.warehouseId, []);

      await expectConflict(
        services.picking.start({
          batchId: batch.batchId,
          actorId: worker.id,
          idempotencyKey: `unconfigured-start-${randomUUID()}`,
        }),
        'has no picking strategy configuration',
      );

      // 거부는 어떤 세션도, 시작 표시도 남기지 않는다.
      const sessions = await tx
        .select({ id: wmsTables.batchInventorySessions.id })
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, batch.batchId));
      expect(sessions).toHaveLength(0);
      const [stored] = await tx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batch.batchId));
      expect(stored.startedAt).toBeNull();
    });
  });

  it('refuses to start a batch after the batch strategy is disabled for the warehouse', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2], ['discrete']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch } = await createBatchWithShipments(services, world, manager);

      // 창고는 여전히 설정돼 있지만 배치가 요구하는 discrete 만 빠졌다.
      await revokeWarehouseStrategies(tx, world.warehouseId, ['pick_to_tote']);

      await expectConflict(
        services.picking.start({
          batchId: batch.batchId,
          actorId: worker.id,
          idempotencyKey: `revoked-start-${randomUUID()}`,
        }),
        'is not enabled for warehouse',
      );

      // 세션도 만들어지지 않고 배치는 시작 전으로 남는다.
      const sessions = await tx
        .select({ id: wmsTables.batchInventorySessions.id })
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, batch.batchId));
      expect(sessions).toHaveLength(0);
      const [stored] = await tx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batch.batchId));
      expect(stored.startedAt).toBeNull();
    });
  });

  it('derives the strategy from the batch when the request omits it', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2], ['discrete']);
      await seedRegisteredWaybills(tx, world);
      const services = makeServices(db, tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch } = await createBatchWithShipments(services, world, manager);

      const idempotencyKey = `derived-start-${randomUUID()}`;
      const started = await services.picking.start({ batchId: batch.batchId, actorId: worker.id, idempotencyKey });

      expect(started.state).toBe('started');
      const [row] = await tx
        .select({ commandType: wmsTables.fulfillmentCommandRequests.commandType })
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, idempotencyKey))
        .limit(1);
      expect(row.commandType).toBe('picking.discrete.start');
    });
  });
});
