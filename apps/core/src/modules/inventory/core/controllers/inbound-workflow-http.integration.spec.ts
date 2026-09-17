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
import { buildWiring, Database } from '../../inbound/services/__fixtures__/inbound-harness';
import { wmsSchema, wmsTables } from '../../schema/inventory.schema';

// Only the unused native OS transport is replaced. All requests below cross a
// real listening HTTP socket into production routes/services and PostgreSQL.
jest.mock('@tauri-apps/plugin-http', () => ({ fetch: jest.fn() }), { virtual: true });

const databaseUrl = process.env.DATABASE_URL;
if (process.env.REQUIRE_INBOUND_WORKFLOW_DB === '1' && !databaseUrl) {
  throw new Error('A dedicated migrated DATABASE_URL is required for the inbound workflow acceptance suite.');
}
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('inbound workflow capability → native runner → Core HTTP → PostgreSQL', () => {
  let app: INestApplication;
  let client: postgres.Sql;
  let db: Database;
  let baseUrl: string;
  const actorId = randomUUID();
  const fixtures: Array<{ warehouseId: string; holderId: string; skuId: string }> = [];
  const operationKeys: string[] = [];

  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 4 });
    db = drizzle(client, { schema: wmsSchema });
    const wiring = buildWiring(db);
    const { dbService, command, location, eventStore, idempotency, guard } = wiring;
    const catalogReader = new SkuCatalogReader(dbService);
    const catalog = new SkuCatalogService(catalogReader, new SkuCatalogManager(dbService, catalogReader));
    const module = await Test.createTestingModule({
      controllers: [WarehouseWorkContextController, InboundController, MovementController],
      providers: [
        ScopeGuard,
        {
          provide: AuthorizationService,
          useValue: {
            getScopesByRoles: (roles: string[]) =>
              Promise.resolve(new Set(roles.includes('worker') ? ['inventory.operate'] : [])),
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
    for (const f of fixtures)
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM inbound_work_logs WHERE warehouse_id = ${f.warehouseId}`);
        await tx.execute(sql`DELETE FROM inbound_receipt_lines WHERE sku_id = ${f.skuId}`);
        await tx.execute(sql`DELETE FROM inbound_receipts WHERE warehouse_id = ${f.warehouseId}`);
        const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
        await tx.execute(sql`DELETE FROM stock_events WHERE sku_id = ${f.skuId}`);
        for (const journalId of new Set(events.map((event) => event.journalId).filter(Boolean)))
          await tx.execute(sql`DELETE FROM stock_journals WHERE id = ${journalId}`);
        await tx.execute(sql`DELETE FROM stock_ledgers WHERE sku_id = ${f.skuId}`);
        await tx.execute(sql`DELETE FROM skus WHERE id = ${f.skuId}`);
        await tx.execute(sql`DELETE FROM holders WHERE id = ${f.holderId}`);
        await tx.execute(sql`DELETE FROM locations WHERE warehouse_id = ${f.warehouseId}`);
        await tx.execute(sql`DELETE FROM warehouses WHERE id = ${f.warehouseId}`);
      });
    for (const key of operationKeys)
      await db
        .delete(wmsTables.inventoryIdempotencyRequests)
        .where(eq(wmsTables.inventoryIdempotencyRequests.key, key));
    await client.end();
  });
  function runtime(doFetch: typeof fetch = fetch, name = randomUUID()) {
    const api = createApiClient({ baseUrl, getToken: async () => 'local-worker', authMode: 'bearer', doFetch });
    const store = createOperationStore(name);
    const runner = createOperationRunner({
      api,
      store,
      getScope: async () => `${baseUrl}:${actorId}`,
      wait: async () => {},
    });
    return { api, store, runner, name, scope: `${baseUrl}:${actorId}` };
  }
  async function seed(r: ReturnType<typeof runtime>) {
    const [warehouse] = await db.insert(wmsTables.warehouses).values({ name: randomUUID() }).returning();
    const [holder] = await db.insert(wmsTables.holders).values({ name: randomUUID() }).returning();
    const [sku] = await db
      .insert(wmsTables.skus)
      .values({ name: 'HTTP 상품', code: randomUUID(), holderId: holder.id })
      .returning();
    const [destination] = await db
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: randomUUID(), locationType: 'zone' })
      .returning();
    fixtures.push({ warehouseId: warehouse.id, holderId: holder.id, skuId: sku.id });
    const key = randomUUID();
    operationKeys.push(key);
    const receipt = await r.runner.request<{
      receipt: { id: string };
      lines: Array<{ id: string; originLocationId: string }>;
    }>({
      method: 'POST',
      path: '/inbound/simple',
      idempotencyKey: key,
      body: { warehouseId: warehouse.id, items: [{ skuId: sku.id, quantity: 10 }] },
    });
    return { warehouse, sku, destination, line: receipt.lines[0] };
  }
  async function current(r: ReturnType<typeof runtime>, f: Awaited<ReturnType<typeof seed>>) {
    return r.api.request({ path: `/inbound/lines/${f.line.id}/state?warehouseId=${f.warehouse.id}` });
  }
  async function assertRejected(r: ReturnType<typeof runtime>, path: string, body: unknown, code: string) {
    const key = randomUUID();
    operationKeys.push(key);
    await expect(r.runner.request({ method: 'POST', path, body, idempotencyKey: key })).rejects.toMatchObject({
      outcome: 'rejected',
      code,
    });
    expect(await r.store.get(key)).toMatchObject({ status: 'rejected', errorCode: code, attempts: 1 });
    expect(await r.store.pending(r.scope)).toEqual([]);
  }
  it.each(['shelf', 'missing-event', 'wrong-event', 'voided', 'partial-cancel'] as const)(
    'putaway HTTP rejects %s legacy facts without stock or receipt side effects',
    async (damage) => {
      const r = runtime();
      const f = await seed(r);
      if (damage === 'shelf')
        await db.execute(
          sql`UPDATE locations SET is_system = false, system_role = NULL WHERE id = ${f.line.originLocationId}`,
        );
      if (damage === 'missing-event')
        await db.execute(sql`UPDATE inbound_receipt_lines SET event_id = NULL WHERE id = ${f.line.id}`);
      if (damage === 'wrong-event')
        await db.execute(
          sql`UPDATE stock_events SET transition_type = 'ADJUST_UP' WHERE id = (SELECT event_id FROM inbound_receipt_lines WHERE id = ${f.line.id})`,
        );
      if (damage === 'voided')
        await db.execute(
          sql`UPDATE inbound_receipts SET status = 'voided' WHERE id = (SELECT receipt_id FROM inbound_receipt_lines WHERE id = ${f.line.id})`,
        );
      if (damage === 'partial-cancel')
        await db.execute(sql`UPDATE inbound_receipt_lines SET canceled_qty = 1 WHERE id = ${f.line.id}`);
      const blocked = (await current(r, f)) as { canPutaway: boolean; putawayBlockReason: string };
      expect(blocked.canPutaway).toBe(false);
      const snapshot = async () => ({
        lines: await db
          .select()
          .from(wmsTables.inboundReceiptLines)
          .where(eq(wmsTables.inboundReceiptLines.skuId, f.sku.id)),
        stock: await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.sku.id)),
        events: await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.sku.id)),
        logs: await db
          .select()
          .from(wmsTables.inboundWorkLogs)
          .where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouse.id)),
      });
      const before = await snapshot();
      const key = randomUUID();
      operationKeys.push(key);
      const response = await fetch(`${baseUrl}/inbound/putaway`, {
        method: 'POST',
        headers: { authorization: 'Bearer local-worker', 'content-type': 'application/json' },
        body: JSON.stringify({ lineId: f.line.id, toLocationId: f.destination.id, quantity: 1, idempotencyKey: key }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: 'receipt is not eligible for putaway' });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('allows older receipts to put away the residual after partial return and partial putaway', async () => {
    const r = runtime();
    const f = await seed(r);
    await db.execute(
      sql`UPDATE inbound_receipts SET occurred_at = now() - interval '90 days' WHERE id = (SELECT receipt_id FROM inbound_receipt_lines WHERE id = ${f.line.id})`,
    );
    const mutate = async (path: string, body: Record<string, unknown>) => {
      const key = randomUUID();
      operationKeys.push(key);
      return r.runner.request({ method: 'POST', path, body: { ...body, idempotencyKey: key }, idempotencyKey: key });
    };
    await mutate('/inbound/return', { lineId: f.line.id, quantity: 3 });
    expect(await current(r, f)).toMatchObject({ returnedQty: 3, pendingQty: 7, canPutaway: true, canCancel: false });
    await mutate('/inbound/putaway', { lineId: f.line.id, toLocationId: f.destination.id, quantity: 2 });
    expect(await current(r, f)).toMatchObject({
      returnedQty: 3,
      putawayFromOriginQty: 2,
      pendingQty: 5,
      canPutaway: true,
    });
    await mutate('/inbound/putaway', { lineId: f.line.id, toLocationId: f.destination.id, quantity: 5 });
    expect(await current(r, f)).toMatchObject({
      returnedQty: 3,
      putawayFromOriginQty: 7,
      pendingQty: 0,
      canPutaway: false,
    });
    const stock = await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.sku.id));
    expect(stock.find((row) => row.locationId === f.line.originLocationId)?.qty).toBe(0);
    expect(stock.find((row) => row.locationId === f.destination.id)?.qty).toBe(7);
    expect(await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.sku.id))).toHaveLength(
      4,
    );
    expect(
      await db
        .select()
        .from(wmsTables.inboundWorkLogs)
        .where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouse.id)),
    ).toHaveLength(4);
  });

  it('advertises the capability only with protected movement and an authoritative current-state route', async () => {
    const r = runtime();
    expect(await r.api.request({ path: '/inventory/work-context' })).toMatchObject({
      capabilities: { inboundWorkflowConsistency: true },
    });
    const f = await seed(r);
    await assertRejected(
      r,
      '/movement/move',
      {
        warehouseId: f.warehouse.id,
        lines: [
          { skuId: f.sku.id, fromLocationId: f.line.originLocationId, toLocationId: f.destination.id, quantity: 1 },
        ],
      },
      'INBOUND_ORIGIN_STOCK_PROTECTED',
    );
    expect(await current(r, f)).toMatchObject({ pendingQty: 10, putawayFromOriginQty: 0, canPutaway: true });
    const ledgers = await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.sku.id));
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].qty).toBe(10);
    const denied = await fetch(`${baseUrl}/inbound/lines/${f.line.id}/state?warehouseId=${f.warehouse.id}`);
    expect(denied.status).toBe(403);
    await expect(
      r.api.request({ path: `/inbound/lines/${f.line.id}/state?warehouseId=${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('settles invalid destination and inconsistent origin as rejected without a permanent pending operation', async () => {
    const r = runtime();
    const f = await seed(r);
    await assertRejected(
      r,
      '/inbound/putaway',
      { lineId: f.line.id, toLocationId: f.line.originLocationId, quantity: 1 },
      'INBOUND_PUTAWAY_DESTINATION_INVALID',
    );
    // Explicit legacy corruption fixture; no production bypass API is added.
    await db.execute(sql`UPDATE stock_ledgers SET qty = 5 WHERE sku_id = ${f.sku.id}`);
    await assertRejected(
      r,
      '/movement/move',
      {
        warehouseId: f.warehouse.id,
        lines: [
          { skuId: f.sku.id, fromLocationId: f.line.originLocationId, toLocationId: f.destination.id, quantity: 1 },
        ],
      },
      'INBOUND_ORIGIN_STOCK_INCONSISTENT',
    );
    expect(await current(r, f)).toMatchObject({
      pendingQty: 10,
      canPutaway: false,
      putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT',
    });
  });
  it('recovers a committed cancellation with its original key/body before resuming from current server state', async () => {
    const sent: Array<{ key: string | null; body: string | undefined }> = [];
    let drop = true;
    const transport: typeof fetch = async (url, init) => {
      const key = randomUUID();
      operationKeys.push(key);
      const response = await fetch(url, init);
      if (String(url).endsWith('/inbound/cancel')) {
        sent.push({ key: new Headers(init?.headers).get('idempotency-key'), body: init?.body as string });
        if (drop) {
          await response.text();
          throw new ApiError('response lost after server commit', 0);
        }
      }
      return response;
    };
    const r = runtime(transport);
    const f = await seed(r);
    const key = randomUUID();
    operationKeys.push(key);
    const original = r.runner.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: { lineId: f.line.id, quantity: 10 },
      idempotencyKey: key,
    });
    // Await the durable uncertain state and release, not an arbitrary UI delay.
    for (let n = 0; n < 100; n++) {
      const saved = await r.store.get(key);
      if (saved?.status === 'uncertain' && saved.leaseExpiresAt === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const uncertain = await r.store.get(key);
    expect(uncertain).toMatchObject({ status: 'uncertain', attempts: 1, leaseExpiresAt: 0 });
    expect(await current(r, f)).toMatchObject({
      canceledQty: 10,
      pendingQty: 0,
      canPutaway: false,
      putawayBlockReason: 'CANCELED',
    });
    drop = false;
    // A newly constructed store/runner models persisted app recovery (not an actual OS restart).
    const resumed = runtime(transport, r.name);
    await resumed.runner.restore();
    expect(await resumed.store.pending(r.scope)).toHaveLength(1);
    await resumed.runner.retryPending();
    await r.runner.retryPending();
    await expect(original).resolves.toMatchObject({ success: true });
    const confirmed = await resumed.store.get(key);
    expect(confirmed).toMatchObject({ status: 'confirmed', attempts: 2, bodyJson: uncertain!.bodyJson });
    // Replay on the original transport additionally verifies wire identity and the historical result.
    const replay = await r.api.request({
      method: 'POST',
      path: '/inbound/cancel',
      body: JSON.parse(uncertain!.bodyJson),
      bodyJson: uncertain!.bodyJson,
      idempotencyKey: key,
    });
    expect(replay).toEqual(confirmed!.result);
    expect(sent).toHaveLength(3);
    for (const attempt of sent) expect(attempt).toEqual({ key, body: uncertain!.bodyJson });
    expect(await resumed.store.pending(r.scope)).toEqual([]);
    expect(await current(resumed, f)).toMatchObject({
      receiptStatus: 'voided',
      canceledQty: 10,
      pendingQty: 0,
      canCancel: false,
      canPutaway: false,
    });
    const events = await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.sku.id));
    expect(events).toHaveLength(2); // one arrival and one cancellation, despite replay
    expect(await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.sku.id))).toEqual([
      expect.objectContaining({ qty: 0 }),
    ]);
  });
});
