import { randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres uses export = in Jest CJS.
import postgres = require('postgres');
import { DbService } from '@app/db';
import { inventorySchema } from '../inventory/schema/inventory.schema';
import { InventoryIdempotencyService } from '../inventory/core/services/inventory-idempotency.service';
import { DemandProfileRefresher } from '../inventory/replenishment/demand/demand-profile.refresher';
import { ReplenishmentSettingsReader } from '../inventory/replenishment/demand/replenishment-settings.reader';
import { DemandProfileReader } from '../inventory/replenishment/demand/demand-profile.reader';
import { ReplenishmentRulesReader } from '../inventory/replenishment/rules/replenishment-rules.reader';
import { ReplenishmentStockReader } from '../inventory/replenishment/suggestion/replenishment-stock.reader';
import { ReplenishmentSuggestionReader } from '../inventory/replenishment/suggestion/replenishment-suggestion.reader';
import { WarehouseTransferReader } from '../inventory/warehouse-transfer/services/warehouse-transfer.reader';
import { StockProjectionService } from '../inventory/stock-projection/services/stock-projection.service';
import { StockProjectionReader } from '../inventory/stock-projection/services/stock-projection.reader';
import { StockProjectionManager } from '../inventory/stock-projection/services/stock-projection.manager';
import { InboundPipelineReader } from '../inventory/stock-projection/services/inbound-pipeline.reader';
import { ExpectedArrivalsReader } from '../inventory/stock-projection/services/expected-arrivals.reader';
import { PurchaseOrderExpectedArrivalReader } from '../inventory/procurement/services/purchase-order-expected-arrival.reader';
import { wireLogistics } from '../fulfillment/services/__support__';
import { ReplenishmentSuggestionService } from '../inventory/replenishment/suggestion/replenishment-suggestion.service';
import { DemoReplenishmentManager } from './demo-replenishment.manager';
import { parseDemoReplenishmentRequest } from './demo-replenishment.input';

const enabled = process.env.REQUIRE_DEMO_CATALOG_DB === '1';
const databaseUrl =
  process.env.DEMO_CATALOG_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55435/demo_training_core';
(enabled ? describe : describe.skip)('demo replenishment generation with real policy and database', () => {
  let client: ReturnType<typeof postgres>;
  let db: DbService<typeof inventorySchema>;
  let manager: DemoReplenishmentManager;
  let reader: ReplenishmentSuggestionReader;
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const actor = randomUUID();
  const holder = '019f1009-0900-7000-a000-000000000900';
  const supplier = '019f1008-0001-7000-a000-000000000001';
  const priorEnv = { ...process.env };
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/demo_training_core')
      throw new Error('Dedicated local DB only');
    Object.assign(process.env, { APP_STAGE: 'demo', DEMO_CONSOLE_ENABLED: 'true', EXTERNAL_INTEGRATIONS_MODE: 'mock' });
    client = postgres(databaseUrl, { max: 1 });
    db = new DbService({ connectionString: databaseUrl }, inventorySchema);
    const transfer = new WarehouseTransferReader(db);
    const po = new PurchaseOrderExpectedArrivalReader(db);
    const w = wireLogistics(db);
    const projection = new StockProjectionService(
      new StockProjectionReader(db, w.eventStore),
      new StockProjectionManager(w.eventStore),
      new InboundPipelineReader(db, transfer, po),
      new ExpectedArrivalsReader(po),
      db,
    );
    reader = new ReplenishmentSuggestionReader(
      new ReplenishmentStockReader(db),
      projection,
      transfer,
      new ReplenishmentSettingsReader(db),
      new DemandProfileReader(db),
      new ReplenishmentRulesReader(db),
    );
    manager = new DemoReplenishmentManager(
      new InventoryIdempotencyService(db),
      new DemandProfileRefresher(db),
      new ReplenishmentSettingsReader(db),
      new ReplenishmentSuggestionService(db, reader),
    );
    for (const id of ids) {
      await client`INSERT INTO skus (id,holder_id,code,name,moq) VALUES (${id},${holder},${'REAL-' + id},'실제 상품 시연 후보',6)`;
      await client`INSERT INTO sku_suppliers(sku_id,supplier_id) VALUES (${id},${supplier})`;
      await client`INSERT INTO sku_barcodes(sku_id,barcode,is_primary,packing_unit) VALUES (${id},${'BAR-' + id},true,4)`;
    }
  });
  afterAll(async () => {
    process.env = priorEnv;
    if (client) {
      await client`DELETE FROM sku_demand_daily WHERE sku_id IN ${client(ids)}`;
      await client`DELETE FROM sku_demand_profiles WHERE sku_id IN ${client(ids)}`;
      await client`DELETE FROM replenishment_sku_overrides WHERE sku_id IN ${client(ids)}`;
      await client`DELETE FROM purchase_order_lines WHERE sku_id IN ${client(ids)}`;
      await client`DELETE FROM skus WHERE id IN ${client(ids)}`;
      await client.end();
    }
    if (db) await db.onApplicationShutdown();
  });
  it('does not prepare demand for a SKU held by an in-flight purchase transaction', async () => {
    const other = postgres(databaseUrl, { max: 1 });
    const poId = randomUUID();
    let release: () => void = () => {};
    let inserted: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const writing = other.begin(async (tx) => {
      await tx.unsafe(
        "INSERT INTO purchase_orders(id,type,supplier_id,source_warehouse_id,destination_warehouse_id) VALUES ($1,'domestic',$2,'019f1006-0001-7000-a000-000000000001','019f1006-0001-7000-a000-000000000001')",
        [poId, supplier],
      );
      await tx.unsafe('INSERT INTO purchase_order_lines(po_id,sku_id,quantity) VALUES ($1,$2,1)', [poId, ids[8]]);
      inserted();
      await hold;
    });
    try {
      await ready;
      const outcome = manager
        .prepare(parseDemoReplenishmentRequest({ requestId: randomUUID(), mode: 'specified', skuIds: [ids[8]] }), actor)
        .then(
          () => false,
          () => true,
        );
      await new Promise((resolve) => setTimeout(resolve, 200));
      release();
      await writing;
      expect(await outcome).toBe(true);
      const [rows] = await client`SELECT count(*)::int n FROM sku_demand_daily WHERE sku_id=${ids[8]}`;
      expect(rows.n).toBe(0);
    } finally {
      release();
      await writing;
      await other`DELETE FROM purchase_orders WHERE id=${poId}`;
      await other.end();
    }
  });
  it('generates varied demand, uses the real purchase policy/lot size, and replays without further writes', async () => {
    const request = parseDemoReplenishmentRequest({
      requestId: randomUUID(),
      mode: 'specified',
      skuIds: ids.slice(0, 3),
    });
    const result = await manager.prepare(request, actor);
    expect(result.items).toHaveLength(3);
    expect(new Set(result.items.map((x) => x.pattern)).size).toBe(3);
    expect(new Set(result.items.map((x) => x.dailyMean)).size).toBeGreaterThan(1);
    for (const item of result.items) {
      expect(item.purchaseQuantity).toBeGreaterThan(0);
      expect(item.purchaseQuantity).toBeLessThanOrEqual(1000);
      expect(item.purchaseQuantity).toBeGreaterThanOrEqual(6);
      expect(item.purchaseQuantity % 4).toBe(0);
      const detail = await db.run((tx) => reader.findDetail(tx, item.skuId));
      expect(detail.row.actions).toContainEqual(
        expect.objectContaining({ type: 'purchase', qty: item.purchaseQuantity }),
      );
    }
    expect(await manager.prepare(request, actor)).toEqual(result);
    const [rows] =
      await client`SELECT count(*)::int n FROM sku_demand_daily WHERE sku_id IN ${client(ids.slice(0, 3))}`;
    expect(rows.n).toBe(1095);
    await expect(
      manager.prepare(
        parseDemoReplenishmentRequest({ requestId: request.requestId, mode: 'specified', skuIds: ids.slice(3, 6) }),
        actor,
      ),
    ).rejects.toThrow();
    await expect(manager.prepare({ ...request, requestId: randomUUID() }, actor)).rejects.toThrow();
  });
  it('does not alter existing history and rolls back all candidates if one cannot produce a bounded suggestion', async () => {
    await client`UPDATE skus SET moq=100000 WHERE id=${ids[4]}`;
    await expect(
      manager.prepare(
        parseDemoReplenishmentRequest({ requestId: randomUUID(), mode: 'specified', skuIds: ids.slice(3, 5) }),
        actor,
      ),
    ).rejects.toThrow();
    const [rows] =
      await client`SELECT count(*)::int n FROM sku_demand_daily WHERE sku_id IN ${client(ids.slice(3, 5))}`;
    expect(rows.n).toBe(0);
    await client`INSERT INTO sku_demand_daily(sku_id,demand_date,qty,source) VALUES (${ids[3]},'2026-01-01',7,'core')`;
    await expect(
      manager.prepare(
        parseDemoReplenishmentRequest({ requestId: randomUUID(), mode: 'specified', skuIds: [ids[3]] }),
        actor,
      ),
    ).rejects.toThrow();
    expect(await client`SELECT qty,source FROM sku_demand_daily WHERE sku_id=${ids[3]}`).toEqual([
      expect.objectContaining({ qty: 7, source: 'core' }),
    ]);
  });
  it('keeps concurrent different requests from selecting the same unused products', async () => {
    const requests = [0, 1].map(() => parseDemoReplenishmentRequest({ requestId: randomUUID(), count: 2 }));
    const results = await Promise.all(requests.map((r) => manager.prepare(r, actor)));
    expect(new Set(results.flatMap((r) => r.items.map((x) => x.skuId))).size).toBe(4);
  });
  it('rolls back generated history and its marker when the current policy would suggest over 1,000 units', async () => {
    const [previous] = await client<
      { default_cover_days: number }[]
    >`SELECT default_cover_days FROM replenishment_settings WHERE key='default'`;
    await client`UPDATE replenishment_settings SET default_cover_days=100000 WHERE key='default'`;
    await client`UPDATE skus SET moq=6 WHERE id=${ids[4]}`;
    try {
      await expect(
        manager.prepare(
          parseDemoReplenishmentRequest({ requestId: randomUUID(), mode: 'specified', skuIds: [ids[4]] }),
          actor,
        ),
      ).rejects.toThrow('1~1,000');
      const [rows] = await client`SELECT count(*)::int n FROM sku_demand_daily WHERE sku_id=${ids[4]}`;
      const [markers] = await client`SELECT count(*)::int n FROM replenishment_sku_overrides WHERE sku_id=${ids[4]}`;
      expect(rows.n).toBe(0);
      expect(markers.n).toBe(0);
    } finally {
      await client`UPDATE replenishment_settings SET default_cover_days=${previous.default_cover_days} WHERE key='default'`;
    }
  });
  it('stops suggesting another purchase when the suggested quantity is ordered', async () => {
    const detail = await db.run((tx) => reader.findDetail(tx, ids[0]));
    const action = detail.row.actions.find((a) => a.type === 'purchase');
    if (!action || action.type !== 'purchase' || !action.sourceWarehouseId)
      throw new Error('Missing purchase suggestion');
    const poId = randomUUID();
    await client`INSERT INTO purchase_orders(id,type,supplier_id,source_warehouse_id,destination_warehouse_id,status) VALUES (${poId},'domestic',${supplier},${action.sourceWarehouseId},${action.sourceWarehouseId},'confirmed')`;
    try {
      await client`INSERT INTO purchase_order_lines(po_id,sku_id,quantity,status,ordered_qty,ordered_at) VALUES (${poId},${ids[0]},${action.qty},'ordered',${action.qty},now())`;
      const after = await db.run((tx) => reader.findDetail(tx, ids[0]));
      expect(after.row.company.onOrder).toBe(action.qty);
      expect(after.row.actions.filter((a) => a.type === 'purchase')).toEqual([]);
    } finally {
      await client`DELETE FROM purchase_orders WHERE id=${poId}`;
    }
  });
  it('refuses writes outside the exact demo environment', async () => {
    process.env.APP_STAGE = 'live';
    try {
      await expect(
        manager.prepare(parseDemoReplenishmentRequest({ requestId: randomUUID() }), actor),
      ).rejects.toThrow();
    } finally {
      process.env.APP_STAGE = 'demo';
    }
  });
});
