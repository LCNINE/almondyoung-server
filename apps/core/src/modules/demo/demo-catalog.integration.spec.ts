import { randomUUID } from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres uses export = in Jest CJS.
import postgres = require('postgres');
import { DbService } from '@app/db';
import { inventorySchema } from '../inventory/schema/inventory.schema';
import { DemoPracticeService, parsePracticeRequest } from './demo-practice.service';
import { DemandProfileRefresher } from '../inventory/replenishment/demand/demand-profile.refresher';
import { ReplenishmentSettingsReader } from '../inventory/replenishment/demand/replenishment-settings.reader';
import { InventoryIdempotencyService } from '../inventory/core/services/inventory-idempotency.service';
import { makeInboundService } from '../inventory/inbound/services/__fixtures__/inbound-harness';
import { DemoCatalogService, parseDemoCatalogQuery } from './demo-catalog.service';
import { ReplenishmentSeedStep } from '../../../../../scripts/seeding/steps/replenishment.seed-step';
import { DemoLogisticsSeedStep } from '../../../../../scripts/seeding/steps/demo-logistics.seed-step';
import { DEMO_LOGISTICS_FIXTURE as fixture } from '@app/shared/demo-logistics.fixture';

jest.mock('../../../../../scripts/seeding/lib/logger', () => ({
  Logger: class {
    step() {}
    success() {}
    error(message: string) {
      throw new Error(message);
    }
  },
}));

const enabled = process.env.REQUIRE_DEMO_CATALOG_DB === '1';
const databaseUrl =
  process.env.DEMO_CATALOG_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:55435/demo_training_core';
(enabled ? describe : describe.skip)('database-backed demo catalog', () => {
  const ids = { master: randomUUID(), version: randomUUID(), variant: randomUUID(), matching: randomUUID() };
  const a = fixture.catalog[28];
  const b = fixture.catalog[29];
  let client: ReturnType<typeof postgres>;
  let db: DbService<typeof inventorySchema>;
  let service: DemoCatalogService;
  let previousStage: string | undefined;
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/demo_training_core') {
      throw new Error('Catalog tests require the dedicated local demo_training_core database');
    }
    previousStage = process.env.APP_STAGE;
    process.env.APP_STAGE = 'demo';
    const baseline = new ReplenishmentSeedStep(databaseUrl);
    try {
      const result = await baseline.apply();
      if (!result.success) throw new Error(JSON.stringify(result));
    } finally {
      await baseline.dispose();
    }
    const seed = new DemoLogisticsSeedStep(databaseUrl);
    try {
      const result = await seed.apply();
      if (!result.success) throw new Error(JSON.stringify(result));
    } finally {
      await seed.dispose();
    }
    client = postgres(databaseUrl, { max: 1 });
    await client`INSERT INTO product_masters (id) VALUES (${ids.master})`;
    await client`INSERT INTO product_master_versions (id,master_id,status,approval_status,name,fulfillment_kind,market_price)
      VALUES (${ids.version},${ids.master},'active','approved','실습 세트','physical',19000)`;
    await client`INSERT INTO product_variants (id,variant_name,status,variant_code) VALUES (${ids.variant},'실습 세트','active','TRAINING-BUNDLE')`;
    await client`INSERT INTO product_master_variants (id,master_id,version_id,variant_id) VALUES (${randomUUID()},${ids.master},${ids.version},${ids.variant})`;
    await client`INSERT INTO product_matchings (id,variant_id,master_id,status,is_resolved,strategy) VALUES (${ids.matching},${ids.variant},${ids.master},'matched',true,'variant')`;
    await client`INSERT INTO product_variant_sku_links (product_matching_id,sku_id,quantity) VALUES (${ids.matching},${a.skuId},2),(${ids.matching},${b.skuId},3)`;
    db = new DbService({ connectionString: databaseUrl }, inventorySchema);
    service = new DemoCatalogService(db);
  }, 60000);
  afterAll(async () => {
    if (client) {
      await client`DELETE FROM product_matchings WHERE id=${ids.matching}`;
      await client`DELETE FROM product_master_variants WHERE master_id=${ids.master}`;
      await client`DELETE FROM product_variants WHERE id=${ids.variant}`;
      await client`DELETE FROM product_masters WHERE id=${ids.master}`;
      await client.end();
    }
    if (db) await db.onApplicationShutdown();
    if (previousStage === undefined) delete process.env.APP_STAGE;
    else process.env.APP_STAGE = previousStage;
  });
  it('finds a non-fixture variant and computes limiting bundle stock from all components', async () => {
    const result = await service.catalog(parseDemoCatalogQuery({ variantIds: ids.variant }));
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ variantId: ids.variant, unitPrice: 19000, availableQuantity: 23 });
    expect(result.items[0].components).toEqual(
      expect.arrayContaining([
        { skuId: a.skuId, quantity: 2, availableQuantity: 69 },
        { skuId: b.skuId, quantity: 3, availableQuantity: 70 },
      ]),
    );
  });
  it('finds every linked variant by a component barcode, and keeps total on empty later pages', async () => {
    const result = await service.catalog(parseDemoCatalogQuery({ search: '880900000029' }));
    expect(result.items.map((item) => item.variantId)).toEqual(expect.arrayContaining([a.variantId, ids.variant]));
    const empty = await service.catalog(parseDemoCatalogQuery({ variantIds: ids.variant, page: 2, limit: 1 }));
    expect(empty).toMatchObject({ items: [], total: 1, page: 2 });
  });
  it('excludes the whole bundle when any component is deleted, not just the deleted component', async () => {
    await client`UPDATE skus SET is_deleted=true WHERE id=${a.skuId}`;
    try {
      const result = await service.catalog(parseDemoCatalogQuery({ variantIds: ids.variant }));
      expect(result.items).toEqual([]);
    } finally {
      await client`UPDATE skus SET is_deleted=false WHERE id=${a.skuId}`;
    }
  });
  it('excludes soft-deleted product versions even if their status is still active', async () => {
    await client`UPDATE product_master_versions SET deleted_at=now() WHERE id=${ids.version}`;
    try {
      expect((await service.catalog(parseDemoCatalogQuery({ variantIds: ids.variant }))).items).toEqual([]);
    } finally {
      await client`UPDATE product_master_versions SET deleted_at=null WHERE id=${ids.version}`;
    }
  });
  it('returns stable seeded pages and filters unavailable variants before paging', async () => {
    const query = parseDemoCatalogQuery({ randomSeed: ids.variant, limit: 3, availableOnly: 'true' });
    const first = await service.catalog(query);
    expect(first.items.length).toBe(3);
    expect(first.items.every((item) => item.availableQuantity > 0)).toBe(true);
    expect((await service.catalog(query)).items).toEqual(first.items);
  });
  it('prepares real receipt/putaway once, rejects changed replay, and rolls back if putaway fails', async () => {
    const profiles = new DemandProfileRefresher(db);
    const refresh = jest.spyOn(profiles, 'refreshSelected');
    const practice = new DemoPracticeService(
      makeInboundService(db.db),
      new InventoryIdempotencyService(db),
      profiles,
      new ReplenishmentSettingsReader(db),
    );
    const actor = randomUUID();
    const request = parsePracticeRequest({
      requestId: randomUUID(),
      items: [{ skuId: b.skuId, quantity: 3 }],
      prepareDemand: true,
    });
    const before = await service.catalog(parseDemoCatalogQuery({ variantIds: b.variantId }));
    const first = await practice.prepare(request, actor);
    expect(first.lines).toEqual([expect.objectContaining({ skuId: b.skuId, quantity: 3 })]);
    expect(await practice.prepare(request, actor)).toEqual(first);
    expect(refresh).toHaveBeenCalledTimes(1);
    const [profile] = await client`SELECT daily_mean, demand_events FROM sku_demand_profiles WHERE sku_id=${b.skuId}`;
    expect(profile.daily_mean).toBeGreaterThan(0);
    expect(profile.demand_events).toBeGreaterThan(300);
    expect((await service.catalog(parseDemoCatalogQuery({ variantIds: b.variantId }))).items[0].availableQuantity).toBe(
      before.items[0].availableQuantity + 3,
    );
    await expect(practice.prepare({ ...request, items: [{ skuId: b.skuId, quantity: 4 }] }, actor)).rejects.toThrow();
    const [countBefore] = await client`SELECT count(*)::int AS count FROM inbound_receipts`;
    await client`UPDATE locations SET is_active=false WHERE id=${fixture.locations[2].id}`;
    try {
      await expect(practice.prepare({ ...request, requestId: randomUUID() }, actor)).rejects.toThrow();
      const [countAfter] = await client`SELECT count(*)::int AS count FROM inbound_receipts`;
      expect(countAfter).toEqual(countBefore);
    } finally {
      await client`UPDATE locations SET is_active=true WHERE id=${fixture.locations[2].id}`;
    }
    // Restore only this dedicated test fixture's stock through a scoped correction in the disposable DB.
    await client`UPDATE stock_ledgers SET qty=qty-3 WHERE sku_id=${b.skuId} AND location_id=${fixture.locations[2].id} AND stock_state='ON_HAND'`;
  });
});
