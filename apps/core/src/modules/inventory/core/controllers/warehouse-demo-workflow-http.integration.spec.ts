import { randomUUID } from 'crypto';
import { Request } from 'express';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthorizationService, ScopeGuard } from '@app/authorization';
import { GlobalExceptionFilter } from '@app/shared/filters/http-exception.filter';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import '../../../../../../../native/warehouse-app/node_modules/fake-indexeddb/auto';
import { ApiError, createApiClient } from '../../../../../../../native/warehouse-app/src/core/data/httpClient';
import { createOperationRunner } from '../../../../../../../native/warehouse-app/src/core/operations/operationRunner';
import { createOperationStore } from '../../../../../../../native/warehouse-app/src/core/operations/operationStore';
import { WarehouseWorkContextController } from './warehouse-work-context.controller';
import { InboundController } from '../../inbound/controllers/inbound.controllers';
import { MovementController } from '../../movement/controllers/movement.controller';
import { InboundService } from '../../inbound/services/inbound.service';
import { InboundPutawayReader } from '../../inbound/services/inbound-putaway.reader';
import { InboundReceiptStateReader } from '../../inbound/services/inbound-receipt-state.reader';
import { InboundReceiptKernel } from '../../inbound/kernel/inbound-receipt.kernel';
import { MovementService } from '../../movement/services/movement.service';
import { SkuCatalogReader } from '../../sku-catalog/services/sku-catalog.reader';
import { SkuCatalogManager } from '../../sku-catalog/services/sku-catalog.manager';
import { SkuCatalogService } from '../../sku-catalog/services/sku-catalog.service';
import { buildWiring, Database, dbServiceFor } from '../../inbound/services/__fixtures__/inbound-harness';
import { wmsSchema, wmsTables } from '../../schema/inventory.schema';

import { LocationOutboundController } from '../../../fulfillment/controllers/location-outbound.controller';
import {
  LocationOutboundService,
  LocationOutboundState,
} from '../../../fulfillment/services/location-outbound.service';
import { assembleOutboundWithDb } from '../../../fulfillment/services/__support__/simple-outbound-wiring';
import {
  seedShipmentForExistingStock,
  PickableShipmentFixture,
} from '../../../fulfillment/services/__support__/logistics-fixtures';
import { cleanupPreparationFixture } from '../../../fulfillment/services/__support__/outbound-preparation-cleanup';
import { snapshot } from '../../movement/services/__support__/movement-location-policy-fixtures';

// Only the unused native OS transport is replaced. All requests below cross a
// real listening HTTP socket into production routes/services and PostgreSQL.
jest.mock('@tauri-apps/plugin-http', () => ({ fetch: jest.fn() }), { virtual: true });

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !databaseUrl) {
  throw new Error('A dedicated migrated DATABASE_URL is required for the warehouse demo acceptance suite.');
}
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('warehouse demo native runner → Core HTTP → PostgreSQL', () => {
  let app: INestApplication;
  let client: postgres.Sql;
  let db: Database;
  let baseUrl: string;
  let actorId = randomUUID();
  const fixtures: PickableShipmentFixture[] = [];
  let outbound: ReturnType<typeof assembleOutboundWithDb>;
  let forceAllowed = true;
  const operationKeys: string[] = [];

  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 4 });
    db = drizzle(client, { schema: wmsSchema });
    const wiring = buildWiring(db);
    outbound = assembleOutboundWithDb(dbServiceFor(db));
    const { dbService, command, location, eventStore, idempotency, guard } = wiring;
    const catalogReader = new SkuCatalogReader(dbService);
    const catalog = new SkuCatalogService(catalogReader, new SkuCatalogManager(dbService, catalogReader));
    const module = await Test.createTestingModule({
      controllers: [WarehouseWorkContextController, InboundController, MovementController, LocationOutboundController],
      providers: [
        ScopeGuard,
        { provide: LocationOutboundService, useValue: outbound.location },
        {
          provide: AuthorizationService,
          useValue: {
            getScopesByRoles: (roles: string[]) =>
              Promise.resolve(
                new Set(
                  roles.includes('worker')
                    ? [
                        'inventory.operate',
                        'fulfillment.warehouse.operate',
                        ...(forceAllowed ? ['fulfillment.dispatch.force'] : []),
                      ]
                    : [],
                ),
              ),
          },
        },
        {
          provide: InboundService,
          useValue: new InboundService(
            dbService,
            catalog,
            eventStore,
            idempotency,
            new InboundReceiptKernel(command, location, eventStore, guard),
          ),
        },
        { provide: MovementService, useValue: new MovementService(dbService, eventStore, idempotency) },
        { provide: InboundPutawayReader, useValue: new InboundPutawayReader(dbService) },
        { provide: InboundReceiptStateReader, useValue: new InboundReceiptStateReader(dbService) },
      ],
    }).compile();
    app = module.createNestApplication();
    // Synthetic local identity; the real ScopeGuard still authorizes every route.
    app.use((req: Request & { user?: { userId: string; roles: string[] } }, _res: unknown, next: () => void) => {
      if (req.headers.authorization === 'Bearer local-worker') req.user = { userId: actorId, roles: ['worker'] };
      next();
    });
    app.useLogger(false);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    if (!db) return;
    try {
      for (const f of fixtures)
        await db.transaction(async (tx) => {
          await tx.execute(sql`DELETE FROM movement_work_logs WHERE warehouse_id = ${f.warehouseId}`);
          await tx.execute(sql`DELETE FROM movement_job_lines WHERE sku_id = ${f.skuId}`);
          await tx.execute(sql`DELETE FROM movement_jobs WHERE warehouse_id = ${f.warehouseId}`);
          await tx.execute(sql`DELETE FROM inbound_work_logs WHERE warehouse_id = ${f.warehouseId}`);
          await tx.execute(sql`DELETE FROM inbound_receipt_lines WHERE sku_id = ${f.skuId}`);
          await tx.execute(sql`DELETE FROM inbound_receipts WHERE warehouse_id = ${f.warehouseId}`);
          await cleanupPreparationFixture(tx, f);
        });
      for (const key of operationKeys)
        await db
          .delete(wmsTables.inventoryIdempotencyRequests)
          .where(eq(wmsTables.inventoryIdempotencyRequests.key, key));
    } finally {
      await client.end();
    }
  });
  beforeEach(() => {
    forceAllowed = true;
    actorId = randomUUID();
  });
  function runtime(doFetch: typeof fetch = fetch, name = randomUUID()) {
    const api = createApiClient({ baseUrl, getToken: async () => 'local-worker', authMode: 'bearer', doFetch });
    const store = createOperationStore(name);
    const scope = `${baseUrl}:${actorId}`;
    const runner = createOperationRunner({ api, store, getScope: async () => scope, wait: async () => {} });
    return { api, store, runner, name, scope };
  }
  type Runtime = ReturnType<typeof runtime>;
  function write<T = unknown>(r: Runtime, path: string, body: unknown, key = randomUUID()) {
    operationKeys.push(key);
    return r.runner.request<T>({ method: 'POST', path, body, idempotencyKey: key });
  }
  async function fixture(r: Runtime) {
    const f = await db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: suffix, supportedPickingStrategies: ['discrete'], isSellable: true })
        .returning();
      const [holder] = await tx.insert(wmsTables.holders).values({ name: suffix }).returning();
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({
          name: suffix,
          sourceType: 'in_house',
          senderSnapshot: { name: 'Sender', phone: '0200000000' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'test',
          supportedFulfillmentModes: ['in_house'],
        })
        .returning();
      const skuCode = `DEMO-${suffix.toUpperCase()}`;
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: '인수 상품', code: skuCode, holderId: holder.id, deliveryProfileId: profile.id })
        .returning();
      const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
      await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
      const [bId, aId] = [randomUUID(), randomUUID()].sort();
      await tx.insert(wmsTables.locations).values([
        { id: aId, warehouseId: warehouse.id, code: `A-${suffix}`, locationType: 'zone' },
        { id: bId, warehouseId: warehouse.id, code: `B-${suffix}`, locationType: 'zone' },
      ]);
      const shipment = await seedShipmentForExistingStock(
        tx,
        {
          actorId,
          warehouseId: warehouse.id,
          holderId: holder.id,
          skuId: sku.id,
          skuCode,
          barcode,
          locationId: aId,
          ledgerVersion: 0,
          deliveryProfileId: profile.id,
        },
        3,
      );
      fixtures.push(shipment);
      return { ...shipment, aId, bId };
    });
    // Stock is created only by the real inbound HTTP operation. Shipment setup has no stock side effect.
    expect(await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId))).toEqual([]);
    const receipt = await write<{ lines: Array<{ id: string; originLocationId: string }> }>(r, '/inbound/simple', {
      warehouseId: f.warehouseId,
      items: [{ skuId: f.skuId, quantity: 10 }],
    });
    return { ...f, line: receipt.lines[0] };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const path = (f: Fixture, op: string) => `/shipments/${f.shipmentId}/location-outbound-${op}`;
  const startBody = (f: Fixture) => ({ warehouseId: f.warehouseId });
  const scanBody = (f: Fixture) => ({
    warehouseId: f.warehouseId,
    sourceLocationId: f.bId,
    barcode: f.barcode,
    quantity: 3,
  });
  const forceBody = (f: Fixture) => ({
    warehouseId: f.warehouseId,
    reason: '인수 확인',
    items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.bId, quantity: 3 }],
  });
  const putaway = (r: Runtime, f: Fixture, toLocationId: string, quantity: number) =>
    write(r, '/inbound/putaway', { lineId: f.line.id, toLocationId, quantity });
  const moveBody = (f: Fixture, quantity = 2) => ({
    warehouseId: f.warehouseId,
    lines: [{ skuId: f.skuId, fromLocationId: f.aId, toLocationId: f.bId, quantity }],
  });
  async function draft(f: Fixture) {
    return outbound.picking.plan({
      batchId: f.batchId,
      shipmentIds: [f.shipmentId],
      actorId,
      idempotencyKey: randomUUID(),
    });
  }
  async function prepare(r: Runtime, f: Fixture, stale = false) {
    await putaway(r, f, f.aId, 6);
    if (stale) {
      await draft(f);
      expect(
        await db
          .select()
          .from(wmsTables.pickingSourceAllocations)
          .where(eq(wmsTables.pickingSourceAllocations.shipmentLineId, f.shipmentLineId)),
      ).toEqual([expect.objectContaining({ sourceLocationId: f.aId, qty: 3 })]);
    }
    await write(r, '/movement/move', moveBody(f));
    await putaway(r, f, f.bId, 4);
    if (!stale) await draft(f);
    const result = await write<LocationOutboundState>(r, path(f, 'starts'), startBody(f));
    // B is the smaller UUID and must supply all three units (A4/B6 before shipment).
    expect(f.bId < f.aId).toBe(true);
    expect(result.sources).toEqual([expect.objectContaining({ sourceLocationId: f.bId, allocatedQty: 3 })]);
    expect(
      (await db.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId)))
        .map((p) => p.status)
        .sort(),
    ).toEqual(stale ? ['active', 'invalidated'] : ['active']);
  }
  async function reconcile(r: Runtime, f: Fixture) {
    expect(
      await r.api.request({ path: `/inbound/lines/${f.line.id}/state?warehouseId=${f.warehouseId}` }),
    ).toMatchObject({ pendingQty: 0 });
    const ledgers = await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
    const quantity = (locationId: string) =>
      ledgers.filter((l) => l.locationId === locationId && l.stockState === 'ON_HAND').reduce((n, l) => n + l.qty, 0);
    expect(quantity(f.line.originLocationId)).toBe(0);
    expect(quantity(f.aId)).toBe(4);
    expect(quantity(f.bId)).toBe(3);
    expect(ledgers.filter((l) => l.stockState === 'ON_HAND').reduce((n, l) => n + l.qty, 0)).toBe(7);
    const events = await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
    expect(events.filter((e) => e.transitionType === 'RECEIVE')).toEqual([expect.objectContaining({ quantity: 10 })]);
    expect(events.filter((e) => e.transitionType === 'SHIP')).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(await r.api.request({ path: `${path(f, 'state')}?warehouseId=${f.warehouseId}` })).toMatchObject({
      status: 'shipped',
      sources: [],
    });
  }
  it.each([false, true])('conserves receive10 → A6 → AtoB2 → B4 → ship3 (draft before move=%s)', async (stale) => {
    const r = runtime();
    const f = await fixture(r);
    await prepare(r, f, stale);
    const key = randomUUID();
    const result = await write(r, path(f, 'scans'), scanBody(f), key);
    expect(result).toMatchObject({ status: 'shipped' });
    expect(
      await r.api.request({ method: 'POST', path: path(f, 'scans'), body: scanBody(f), idempotencyKey: key }),
    ).toEqual(result);
    await reconcile(r, f);
  });
  it('rejects inactive movement with HTTP409 and leaves ledger/events/jobs/logs unchanged', async () => {
    const r = runtime();
    const f = await fixture(r);
    await putaway(r, f, f.aId, 6);
    await db.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.bId));
    const before = await db.transaction((tx) => snapshot(tx, f));
    const key = randomUUID();
    operationKeys.push(key);
    await expect(
      r.api.request({
        method: 'POST',
        path: '/movement/move',
        body: { ...moveBody(f), contractVersion: 2, idempotencyKey: key },
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'MOVEMENT_DESTINATION_INACTIVE' });
    expect(await db.transaction((tx) => snapshot(tx, f))).toEqual(before);
  });
  async function shortage(r: Runtime, f: Fixture) {
    await putaway(r, f, f.aId, 3);
    await draft(f);
    // External stock depletion fault: the source changes after draft, before HTTP preparation.
    await db
      .update(wmsTables.stockLedgers)
      .set({ qty: 0, version: 2 })
      .where(eq(wmsTables.stockLedgers.locationId, f.aId));
  }
  it('commits invalidated draft and rejection across HTTP409; same key replays, explicit new key re-evaluates', async () => {
    const r = runtime();
    const f = await fixture(r);
    await shortage(r, f);
    const key = randomUUID();
    await expect(
      r.api.request({ method: 'POST', path: path(f, 'starts'), body: startBody(f), idempotencyKey: key }),
    ).rejects.toMatchObject({ status: 409, code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' });
    await expect(write(r, path(f, 'starts'), startBody(f), key)).rejects.toMatchObject({
      code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED',
      preparation: { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' },
    });
    const observer = postgres(databaseUrl!, { max: 1 });
    try {
      expect(await observer`select status from picking_plans where batch_id=${f.batchId}`).toEqual([
        expect.objectContaining({ status: 'invalidated' }),
      ]);
      const [saved] =
        await observer`select status, response_snapshot from fulfillment_command_requests where idempotency_key=${key}`;
      expect(saved).toMatchObject({
        status: 'completed',
        response_snapshot: { outcome: 'preparation_blocked', reasonCode: 'SOURCE_INSUFFICIENT' },
      });
      expect(await observer`select id from batch_inventory_sessions where batch_id=${f.batchId}`).toHaveLength(0);
      expect(await observer`select status, picker_id from outbound_batch_work_items where id=${f.workItemId}`).toEqual([
        expect.objectContaining({ status: 'queued', picker_id: null }),
      ]);
    } finally {
      await observer.end();
    }
    await db.update(wmsTables.locations).set({ isActive: true }).where(eq(wmsTables.locations.id, f.bId));
    await putaway(r, f, f.bId, 3);
    await expect(
      r.api.request({ method: 'POST', path: path(f, 'starts'), body: startBody(f), idempotencyKey: key }),
    ).rejects.toMatchObject({ status: 409, code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' });
    expect(await r.store.get(key)).toMatchObject({ status: 'rejected', attempts: 1 });
    expect(await write(r, path(f, 'starts'), startBody(f))).toMatchObject({
      status: 'in_progress',
      sources: [expect.objectContaining({ sourceLocationId: f.bId, allocatedQty: 3 })],
    });
  });
  async function waitUncertain(r: Runtime, key: string) {
    for (let n = 0; n < 200; n++) {
      const op = await r.store.get(key);
      if (op?.status === 'uncertain' && op.leaseExpiresAt === 0) return op;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('operation did not persist uncertainty and release its lease');
  }
  it.each(['success', 'blocked'] as const)(
    'recovers lost %s response in a new store/runner with original key/body',
    async (outcome) => {
      let drop = true;
      const sent: Array<{ key: string | null; body: unknown }> = [];
      const op = outcome === 'success' ? 'scans' : 'starts';
      const transport: typeof fetch = async (url, init) => {
        const response = await fetch(url, init);
        if (String(url).endsWith(`location-outbound-${op}`)) {
          sent.push({ key: new Headers(init?.headers).get('Idempotency-Key'), body: init?.body });
          if (drop) {
            await response.text();
            throw new ApiError('response lost after commit', 0);
          }
        }
        return response;
      };
      const r = runtime(transport);
      const f = await fixture(r);
      if (outcome === 'success') await prepare(r, f);
      else await shortage(r, f);
      const key = randomUUID();
      const original = write(r, path(f, op), outcome === 'success' ? scanBody(f) : startBody(f), key);
      // Attach rejection immediately, while retaining the caller for the recovered terminal outcome.
      const settled = original.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      const uncertain = await waitUncertain(r, key);
      drop = false;
      const resumed = runtime(transport, r.name);
      await resumed.runner.restore();
      await resumed.runner.retryPending();
      await r.runner.retryPending();
      const saved = await resumed.store.get(key);
      expect(saved).toMatchObject({
        status: outcome === 'success' ? 'confirmed' : 'rejected',
        attempts: 2,
        bodyJson: uncertain.bodyJson,
      });
      expect(sent).toEqual([
        { key, body: uncertain.bodyJson },
        { key, body: uncertain.bodyJson },
      ]);
      if (outcome === 'success') {
        expect(await settled).toMatchObject({ value: { status: 'shipped' } });
        await reconcile(resumed, f);
      } else {
        expect(await settled).toMatchObject({ error: { code: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' } });
        expect(saved?.preparation).toEqual({ reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' });
      }
      expect(await resumed.store.pending(r.scope)).toEqual([]);
    },
  );
  it.each(['success', 'blocked'] as const)(
    'resolves lost force %s after permission revocation without repeating force',
    async (outcome) => {
      let drop = true;
      const urls: string[] = [];
      const transport: typeof fetch = async (url, init) => {
        urls.push(String(url));
        if (drop && String(url).endsWith('location-outbound-force-resolutions'))
          throw new ApiError('offline resolver', 0);
        const response = await fetch(url, init);
        if (drop && String(url).endsWith('location-outbound-forces')) {
          await response.text();
          forceAllowed = false;
          throw new ApiError('force response lost', 0);
        }
        return response;
      };
      const r = runtime(transport);
      const f = await fixture(r);
      if (outcome === 'success') await prepare(r, f);
      else await shortage(r, f);
      const key = randomUUID();
      const original = write(r, path(f, 'forces'), forceBody(f), key);
      const settled = original.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      const uncertain = await waitUncertain(r, key);
      drop = false;
      const resumed = runtime(transport, r.name);
      await resumed.runner.restore();
      await resumed.runner.retryPending();
      await r.runner.retryPending();
      expect(await settled).toMatchObject(
        outcome === 'success'
          ? { value: { status: 'shipped' } }
          : { error: { code: 'LOCATION_OUTBOUND_FORCE_NOT_APPLIED' } },
      );
      expect(await resumed.store.get(key)).toMatchObject({
        status: outcome === 'success' ? 'confirmed' : 'rejected',
        bodyJson: uncertain.bodyJson,
      });
      expect(urls.filter((url) => url.endsWith('location-outbound-forces'))).toHaveLength(1);
      await expect(
        resumed.api.request({
          method: 'POST',
          path: path(f, 'forces'),
          body: forceBody(f),
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 403 });
      if (outcome === 'success') await reconcile(resumed, f);
      else {
        const [saved] = await db
          .select()
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key));
        expect(saved.responseSnapshot).toMatchObject({
          outcome: 'preparation_blocked',
          reasonCode: 'SOURCE_INSUFFICIENT',
        });
        const events = await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
        expect(events.filter((e) => e.transitionType === 'SHIP')).toHaveLength(0);
      }
    },
  );
});
