import { Server } from 'http';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { AuthorizationService, ScopeGuard } from '@app/authorization';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import * as request from 'supertest';
import { LocationOutboundController } from '../controllers/location-outbound.controller';
import { SimpleOutboundController } from '../controllers/simple-outbound.controller';
import { ShipmentWaybillReader } from '../reader/shipment-waybill.reader';
import { LocationOutboundService } from './location-outbound.service';
import { SimpleOutboundService } from './simple-outbound.service';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { SCOPE_AUTHORIZATION_DECISION_BRAND, ScopeAuthorizationDecision } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { addSecondSimpleOutboundLine } from './__support__/simple-outbound-fixtures';
import * as wiring from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// The public assembler is deliberately checked before calling it: missing feature is a red assertion.
describeIfDb('location outbound service wiring', () => {
  it('provides the location contract on the real simple outbound graph', () => {
    expect(wiring).toHaveProperty('assembleLocationOutbound', expect.any(Function));
  });
});

const authorization: ScopeAuthorizationDecision = {
  scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
  granted: true,
  [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
};

async function setup(tx: DbTx, split = false) {
  const f = await seedPickableShipment(tx, 3);
  const service = wiring.assembleLocationOutbound(tx);
  const actor = { id: f.actorId, roles: ['logistics_worker'] };
  const first = await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
  const [plan] = await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId));
  const [session] = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
  const [b] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: f.warehouseId, code: `B-${randomUUID()}`, locationType: 'zone' })
    .returning();
  const [ledger] = await tx
    .insert(wmsTables.stockLedgers)
    .values({ skuId: f.skuId, warehouseId: f.warehouseId, locationId: b.id, stockState: 'ON_HAND', qty: 1 })
    .returning();
  if (split) {
    await tx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: 2 })
      .where(eq(wmsTables.pickingSourceAllocations.planId, plan.id));
    await tx
      .update(wmsTables.batchInventorySessionBalances)
      .set({ qty: 2 })
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
        ),
      );
    await tx.insert(wmsTables.pickingSourceAllocations).values({
      planId: plan.id,
      shipmentLineId: f.shipmentLineId,
      sourceLocationId: b.id,
      qty: 1,
      sourceStockVersion: ledger.version,
    });
    await tx
      .insert(wmsTables.batchInventorySessionBalances)
      .values({ sessionId: session.id, skuId: f.skuId, sourceLocationId: b.id, custodyType: 'AT_SOURCE', qty: 1 });
  }
  const scan = { warehouseId: f.warehouseId, sourceLocationId: b.id, barcode: f.barcode, quantity: 1 };
  return { f, service, actor, first, b, scan, session };
}

async function effects(tx: DbTx, batchId: string) {
  return {
    plans: await tx.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, batchId)),
    sessions: await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.batchId, batchId)),
    work: await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId)),
  };
}

describeIfDb('LocationOutboundService — real inventory', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('GET is read-only, wrong warehouse rejects before preparing, start and replay create one plan/session/claim', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const service = wiring.assembleLocationOutbound(tx);
      const actor = { id: f.actorId, roles: ['logistics_worker'] };
      const before = await effects(tx, f.batchId);
      const state = await service.getState(f.shipmentId, f.warehouseId, tx);
      expect(state).toMatchObject({ warehouseId: f.warehouseId, sources: [], lines: [{ pickedQty: 0 }] });
      expect(await effects(tx, f.batchId)).toEqual(before);
      await expect(
        service.start(f.shipmentId, { warehouseId: randomUUID() }, actor, randomUUID(), tx),
      ).rejects.toMatchObject({ response: { code: 'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH' } });
      expect(await effects(tx, f.batchId)).toEqual(before);
      const key = randomUUID();
      const started = await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx);
      expect(await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx)).toEqual(started);
      expect(started.sources).toEqual([
        expect.objectContaining({ sourceLocationId: f.locationId, allocatedQty: 2, pickedQty: 0, remainingQty: 2 }),
      ]);
      const after = await effects(tx, f.batchId);
      expect(after.plans).toHaveLength(1);
      expect(after.sessions).toHaveLength(1);
      expect(after.work[0].pickerId).toBe(actor.id);
      await service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx);
      expect((await effects(tx, f.batchId)).work[0].leaseVersion).toBe(after.work[0].leaseVersion);
      await expect(
        service.start(
          f.shipmentId,
          { warehouseId: f.warehouseId },
          { id: randomUUID(), roles: actor.roles },
          randomUUID(),
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER' } });
    });
  });

  it('scans B only, replays one response, binds location/actor/warehouse and settles only after A finishes', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, b, scan } = await setup(tx, true);
      const key = randomUUID();
      const first = await service.scan(f.shipmentId, scan, actor, key, tx);
      expect(first.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceLocationId: f.locationId, pickedQty: 0, remainingQty: 2 }),
          expect.objectContaining({ sourceLocationId: b.id, pickedQty: 1, remainingQty: 0 }),
        ]),
      );
      expect(await service.scan(f.shipmentId, scan, actor, key, tx)).toEqual(first);
      for (const change of [{ sourceLocationId: f.locationId }, { warehouseId: randomUUID() }, { quantity: 2 }]) {
        await expect(service.scan(f.shipmentId, { ...scan, ...change }, actor, key, tx)).rejects.toMatchObject({
          response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' },
        });
      }
      await expect(service.scan(f.shipmentId, scan, { ...actor, id: randomUUID() }, key, tx)).rejects.toMatchObject({
        response: { code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' },
      });
      const lastInput = { ...scan, sourceLocationId: f.locationId, quantity: 2 };
      const lastKey = randomUUID();
      const done = await service.scan(f.shipmentId, lastInput, actor, lastKey, tx);
      expect(done).toMatchObject({ status: 'shipped', sources: [] });
      expect(done.dispatchAttemptId).not.toBeNull();
      expect(await service.scan(f.shipmentId, lastInput, actor, lastKey, tx)).toEqual(done);
      expect(await service.getState(f.shipmentId, f.warehouseId, tx)).toMatchObject({ status: 'shipped', sources: [] });
      const events = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(and(eq(wmsTables.stockEvents.skuId, f.skuId), eq(wmsTables.stockEvents.transitionType, 'SHIP')));
      expect(events.reduce((sum, event) => sum + event.quantity, 0)).toBe(3);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromLocationId: f.locationId, quantity: 2 }),
          expect.objectContaining({ fromLocationId: b.id, quantity: 1 }),
        ]),
      );
    });
  });

  it.each([false, true])('rejects unallocated B / B overscan before changing custody (split=%s)', async (split) => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, scan, session } = await setup(tx, split);
      const before = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      await expect(service.scan(f.shipmentId, { ...scan, quantity: 2 }, actor, randomUUID(), tx)).rejects.toMatchObject(
        { response: { code: split ? 'LOCATION_OUTBOUND_OVERSCAN' : 'LOCATION_OUTBOUND_SOURCE_MISMATCH' } },
      );
      expect(
        await tx
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id)),
      ).toEqual(before);
    });
  });

  it('force requires the exact remaining tuples, rolls back picks on denied dispatch, and replays success', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, scan, session } = await setup(tx, true);
      const state = await service.scan(f.shipmentId, scan, actor, randomUUID(), tx);
      const items = state.sources
        .filter((s) => s.remainingQty > 0)
        .map((s) => ({
          shipmentLineId: s.shipmentLineId,
          sourceLocationId: s.sourceLocationId,
          quantity: s.remainingQty,
        }));
      const input = { warehouseId: f.warehouseId, reason: '실물 확인', items };
      for (const changed of [
        [],
        [...items, ...items],
        [{ ...items[0], quantity: 1 }],
        [{ ...items[0], shipmentLineId: randomUUID() }],
      ]) {
        await expect(
          service.force(f.shipmentId, { ...input, items: changed }, actor, randomUUID(), authorization, tx),
        ).rejects.toMatchObject({ response: { code: 'LOCATION_OUTBOUND_PROGRESS_CHANGED' } });
      }
      const before = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      await expect(service.force(f.shipmentId, input, actor, randomUUID(), undefined, tx)).rejects.toMatchObject({
        status: 403,
      });
      expect(
        await tx
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id)),
      ).toEqual(before);
      const key = randomUUID();
      const done = await service.force(f.shipmentId, input, actor, key, authorization, tx);
      expect(done).toMatchObject({ status: 'shipped', sources: [] });
      expect(await service.force(f.shipmentId, input, actor, key, authorization, tx)).toEqual(done);
      await expect(service.force(f.shipmentId, input, actor, key, undefined, tx)).rejects.toMatchObject({
        status: 403,
      });
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, f.shipmentLineId));
      expect(line).toMatchObject({ forced: true, inspectedQty: 3 });
    });
  });
  it('isolates the same external key across legacy scan, location scan, and location force', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 4);
      const service = wiring.assembleLocationOutbound(tx);
      const actor = { id: f.actorId, roles: ['logistics_worker'] };
      const key = randomUUID();
      await wiring
        .assembleSimpleOutbound(tx)
        .scan(f.shipmentId, { barcode: f.barcode, quantity: 1, actor, idempotencyKey: key }, tx);
      const state = await service.scan(
        f.shipmentId,
        { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 1 },
        actor,
        key,
        tx,
      );
      expect(state.sources[0].pickedQty).toBe(2);
      const done = await service.force(
        f.shipmentId,
        {
          warehouseId: f.warehouseId,
          reason: 'confirmed',
          items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 2 }],
        },
        actor,
        key,
        authorization,
        tx,
      );
      expect(done.status).toBe('shipped');
    });
  });

  it('rolls back preceding picks, completion and command records if force dispatch fails', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, session } = await setup(tx, true);
      const state = await service.getState(f.shipmentId, f.warehouseId, tx);
      const input = {
        warehouseId: f.warehouseId,
        reason: 'confirmed',
        items: state.sources.map((source) => ({
          shipmentLineId: source.shipmentLineId,
          sourceLocationId: source.sourceLocationId,
          quantity: source.remainingQty,
        })),
      };
      const before = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, f.waybillId));
      const key = randomUUID();
      await expect(service.force(f.shipmentId, input, actor, key, authorization, tx)).rejects.toMatchObject({
        response: { code: 'SHIPMENT_INVOICE_NOT_READY' },
      });
      expect(
        await tx
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id)),
      ).toEqual(before);
      expect((await effects(tx, f.batchId)).work[0].status).toBe('picking');
      expect(
        await tx
          .select()
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key)),
      ).toEqual([]);
      expect(await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId))).toEqual([]);
    });
  });

  it('allows an empty confirmation manifest only when all custody was already picked', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor } = await setup(tx);
      const simple = wiring.assembleSimpleOutbound(tx);
      const context = await simple.prepare(f.shipmentId, actor, randomUUID(), tx);
      await simple.pickScanned(context, f.skuId, 3, actor, randomUUID(), tx, { sourceLocationId: f.locationId });
      const before = await service.getState(f.shipmentId, f.warehouseId, tx);
      expect(before.sources[0].remainingQty).toBe(0);
      const done = await service.force(
        f.shipmentId,
        { warehouseId: f.warehouseId, reason: 'already picked', items: [] },
        actor,
        randomUUID(),
        authorization,
        tx,
      );
      expect(done.status).toBe('shipped');
    });
  });

  it.each([0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1])(
    'service rejects invalid quantity %s',
    async (quantity) => {
      await inRollbackTx(db, async (tx) => {
        const { f, service, actor, scan } = await setup(tx);
        await expect(service.scan(f.shipmentId, { ...scan, quantity }, actor, randomUUID(), tx)).rejects.toMatchObject({
          status: 400,
        });
      });
    },
  );

  it('rejects inactive and cross-warehouse sources without changing progress', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, scan } = await setup(tx);
      const other = await seedPickableShipment(tx, 1);
      await expect(
        service.scan(f.shipmentId, { ...scan, sourceLocationId: other.locationId }, actor, randomUUID(), tx),
      ).rejects.toMatchObject({ response: { code: 'LOCATION_OUTBOUND_SOURCE_MISMATCH' } });
      await tx.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.locationId));
      await expect(
        service.scan(f.shipmentId, { ...scan, sourceLocationId: f.locationId }, actor, randomUUID(), tx),
      ).rejects.toMatchObject({ response: { code: 'LOCATION_OUTBOUND_SOURCE_MISMATCH' } });
      expect((await service.getState(f.shipmentId, f.warehouseId, tx)).sources[0].pickedQty).toBe(0);
    });
  });

  it('rejects unsupported batch methods and terminal boxes through the shared preparation gate', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const service = wiring.assembleLocationOutbound(tx);
      const actor = { id: f.actorId, roles: ['logistics_worker'] };
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'total_picking' })
        .where(eq(wmsTables.outboundBatches.id, f.batchId));
      await expect(
        service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_METHOD_UNSUPPORTED' } });
      expect((await effects(tx, f.batchId)).plans).toHaveLength(0);
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'individual' })
        .where(eq(wmsTables.outboundBatches.id, f.batchId));
      await service.scan(
        f.shipmentId,
        { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 1 },
        actor,
        randomUUID(),
        tx,
      );
      await expect(
        service.start(f.shipmentId, { warehouseId: f.warehouseId }, actor, randomUUID(), tx),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_WORK_ITEM_MISSING' } });
    });
  });

  it('keeps two SKU lines separate and prevents a second actor from changing partially picked work', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const second = await addSecondSimpleOutboundLine(tx, f, 1);
      const service = wiring.assembleLocationOutbound(tx);
      const actor = { id: f.actorId, roles: ['logistics_worker'] };
      const first = await service.scan(
        f.shipmentId,
        { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 1 },
        actor,
        randomUUID(),
        tx,
      );
      expect(first.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skuId: f.skuId, pickedQty: 1 }),
          expect.objectContaining({ skuId: second.skuId, pickedQty: 0 }),
        ]),
      );
      await expect(
        service.scan(
          f.shipmentId,
          { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: second.barcode, quantity: 1 },
          { ...actor, id: randomUUID() },
          randomUUID(),
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER' } });
      const next = await service.scan(
        f.shipmentId,
        { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: second.barcode, quantity: 1 },
        actor,
        randomUUID(),
        tx,
      );
      expect(next.status).toBe('in_progress');
      expect(next.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skuId: f.skuId, pickedQty: 1 }),
          expect.objectContaining({ skuId: second.skuId, pickedQty: 1 }),
        ]),
      );
      const done = await service.scan(
        f.shipmentId,
        { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 1 },
        actor,
        randomUUID(),
        tx,
      );
      expect(done.status).toBe('shipped');
    });
  });
  it('excludes SETTLED custody from source progress on read', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, session } = await setup(tx);
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 2 })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId: session.id,
        skuId: f.skuId,
        sourceLocationId: f.locationId,
        shipmentLineId: f.shipmentLineId,
        custodyType: 'SETTLED',
        qty: 1,
      });
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ settledQty: 1 })
        .where(eq(wmsTables.batchInventorySessions.id, session.id));
      const state = await service.getState(f.shipmentId, f.warehouseId, tx);
      expect(state.sources[0]).toMatchObject({ pickedQty: 0, remainingQty: 3 });
    });
  });

  it('drives HTTP start/state/scan/force through real inventory and returns declared rejection codes', async () => {
    await inRollbackTx(db, async (tx) => {
      const { f, service, actor, scan, b } = await setup(tx, true);
      const module = await Test.createTestingModule({
        controllers: [SimpleOutboundController, LocationOutboundController],
        providers: [
          ScopeGuard,
          {
            provide: AuthorizationService,
            useValue: {
              getScopesByRoles: () =>
                Promise.resolve(new Set([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE, FULFILLMENT_SCOPE.DISPATCH_FORCE])),
            },
          },
          { provide: LocationOutboundService, useValue: service },
          { provide: SimpleOutboundService, useValue: wiring.assembleSimpleOutbound(tx) },
          { provide: ShipmentWaybillReader, useValue: new ShipmentWaybillReader(wiring.ambientDbService(tx)) },
        ],
      }).compile();
      const app = module.createNestApplication();
      app.use((req: { user?: typeof actor }, _res: unknown, next: () => void) => {
        req.user = actor;
        next();
      });
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
      app.useGlobalFilters(new GlobalExceptionFilter());
      await app.init();
      try {
        const server = app.getHttpServer() as Server;
        const prefix = `/shipments/${f.shipmentId}/location-outbound`;
        await request(server)
          .get('/shipments/by-waybill')
          .query({ trackingNo: f.trackingNo, warehouseId: f.warehouseId })
          .expect(200);
        await request(server)
          .get('/shipments/by-waybill')
          .query({ trackingNo: f.trackingNo, warehouseId: randomUUID() })
          .expect(409);
        await request(server)
          .post(`${prefix}-starts`)
          .set('Idempotency-Key', randomUUID())
          .send({ warehouseId: f.warehouseId })
          .expect(201);
        const before = await request(server).get(`${prefix}-state`).query({ warehouseId: f.warehouseId }).expect(200);
        expect(before.body).toHaveProperty(
          'sources',
          expect.arrayContaining([
            expect.objectContaining({ sourceLocationId: b.id }),
            expect.objectContaining({ sourceLocationId: f.locationId }),
          ]),
        );
        const rejected = await request(server)
          .post(`${prefix}-scans`)
          .set('Idempotency-Key', randomUUID())
          .send({ ...scan, quantity: 2 })
          .expect(409);
        expect(rejected.body).toMatchObject({
          code: 'LOCATION_OUTBOUND_OVERSCAN',
          error: 'LOCATION_OUTBOUND_OVERSCAN',
        });
        const key = randomUUID();
        const picked = await request(server).post(`${prefix}-scans`).set('Idempotency-Key', key).send(scan).expect(201);
        expect(picked.body).toHaveProperty(
          'sources',
          expect.arrayContaining([
            expect.objectContaining({ sourceLocationId: b.id, pickedQty: 1 }),
            expect.objectContaining({ sourceLocationId: f.locationId, pickedQty: 0 }),
          ]),
        );
        const replay = await request(server).post(`${prefix}-scans`).set('Idempotency-Key', key).send(scan).expect(201);
        expect(replay.body).toEqual(picked.body);
        const force = {
          warehouseId: f.warehouseId,
          reason: 'physically confirmed',
          items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 2 }],
        };
        const done = await request(server)
          .post(`${prefix}-forces`)
          .set('Idempotency-Key', randomUUID())
          .send(force)
          .expect(201);
        expect(done.body).toMatchObject({ status: 'shipped', sources: [] });
        const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
        expect(events).toHaveLength(2);
        expect(events.reduce((sum, event) => sum + event.quantity, 0)).toBe(3);
      } finally {
        await app.close();
      }
    });
  });
});

// Committed UUID-scoped fixtures let independent connections exercise PostgreSQL locks.
// No resets or deletion of other fixtures; test execution uses the isolated station database.
describeIfDb('location outbound concurrent commands on independent connections', () => {
  const first = makeDb(DATABASE_URL as string);
  const second = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await Promise.all([first.sql.end({ timeout: 5 }), second.sql.end({ timeout: 5 })]);
  });

  it('serializes same-key starts and different-key source scans without duplicate custody', async () => {
    const f = await first.db.transaction((tx) => seedPickableShipment(tx, 3));
    const actor = { id: f.actorId, roles: ['logistics_worker'] };
    const key = randomUUID();
    const results = await Promise.all(
      [first, second].map((connection) =>
        connection.db.transaction((tx) =>
          wiring.assembleLocationOutbound(tx).start(f.shipmentId, { warehouseId: f.warehouseId }, actor, key, tx),
        ),
      ),
    );
    expect(results[1]).toEqual(results[0]);
    await first.db.transaction(async (tx) => {
      const state = await effects(tx, f.batchId);
      expect(state.plans).toHaveLength(1);
      expect(state.sessions).toHaveLength(1);
      expect(state.work[0]).toMatchObject({ pickerId: actor.id, leaseVersion: 1 });
    });
    const input = { warehouseId: f.warehouseId, sourceLocationId: f.locationId, barcode: f.barcode, quantity: 2 };
    const scans = await Promise.allSettled(
      [first, second].map((connection) =>
        connection.db.transaction((tx) =>
          wiring.assembleLocationOutbound(tx).scan(f.shipmentId, input, actor, randomUUID(), tx),
        ),
      ),
    );
    expect(scans.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(scans.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'LOCATION_OUTBOUND_OVERSCAN' } },
    });
    await first.db.transaction(async (tx) => {
      const state = await wiring.assembleLocationOutbound(tx).getState(f.shipmentId, f.warehouseId, tx);
      expect(state.sources[0]).toMatchObject({ pickedQty: 2, remainingQty: 1 });
    });
  });

  it('allows only one of two actors to start and own the same box', async () => {
    const f = await first.db.transaction((tx) => seedPickableShipment(tx, 3));
    const actors = [
      { id: f.actorId, roles: ['logistics_worker'] },
      { id: randomUUID(), roles: ['logistics_worker'] },
    ];
    const results = await Promise.allSettled(
      [first, second].map((connection, index) =>
        connection.db.transaction((tx) =>
          wiring
            .assembleLocationOutbound(tx)
            .start(f.shipmentId, { warehouseId: f.warehouseId }, actors[index], randomUUID(), tx),
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'SIMPLE_OUTBOUND_CLAIMED_BY_OTHER' } },
    });
    await first.db.transaction(async (tx) => {
      const state = await effects(tx, f.batchId);
      expect(state.plans).toHaveLength(1);
      expect(state.sessions).toHaveLength(1);
      expect(state.work[0].leaseVersion).toBe(1);
      expect(actors.map((actor) => actor.id)).toContain(state.work[0].pickerId);
    });
  });
});
