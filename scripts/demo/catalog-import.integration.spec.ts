import postgres from 'postgres';
import type { Sql } from 'postgres';
import { DEMO_LOGISTICS_FIXTURE } from '../../libs/shared/src/demo-logistics.fixture';
import { DEMO_FIXTURE_HOLDER_ID, deterministicCatalogIds } from './catalog-policy';
import { importCatalogSnapshot } from './catalog-import';
import { readCatalogSnapshot } from './catalog-snapshot';

const SOURCE_URL = process.env.DEMO_CATALOG_SOURCE_TEST_URL;
const TARGET_URL = process.env.DEMO_CATALOG_TARGET_TEST_URL;
const describeIfDatabase = SOURCE_URL && TARGET_URL ? describe : describe.skip;

const IDS = {
  holder: '10000000-0000-4000-8000-000000000001',
  supplier: '10000000-0000-4000-8000-000000000002',
  master: '10000000-0000-4000-8000-000000000003',
  version: '10000000-0000-4000-8000-000000000004',
  variant: '10000000-0000-4000-8000-000000000005',
  masterVariant: '10000000-0000-4000-8000-000000000006',
  matching: '10000000-0000-4000-8000-000000000007',
  skuA: '10000000-0000-4000-8000-000000000008',
  skuB: '10000000-0000-4000-8000-000000000009',
  skuUnlinked: '10000000-0000-4000-8000-000000000010',
  barcodeA: '10000000-0000-4000-8000-000000000011',
  barcodeB: '10000000-0000-4000-8000-000000000012',
  barcodeUnlinked: '10000000-0000-4000-8000-000000000013',
  movementJob: '10000000-0000-4000-8000-000000000014',
  movementWork: '10000000-0000-4000-8000-000000000015',
};

function identityFromUrl(raw: string) {
  const url = new URL(raw);
  return { database: url.pathname.slice(1), host: url.hostname, port: Number(url.port || 5432) };
}

async function serverIdentity(sql: Sql) {
  const [row] = await sql<{ database: string; host: string; port: number }[]>`
    SELECT current_database() AS database, host(inet_server_addr()) AS host, inet_server_port()::int AS port
  `;
  return { database: row.database, host: row.host, port: Number(row.port) };
}

async function seedSource(sql: Sql): Promise<void> {
  await sql`INSERT INTO holders (id, name, is_our_asset) VALUES (${IDS.holder}, 'source holder', true)`;
  await sql`
    INSERT INTO suppliers (id, name, code, phone, email, bank_account_no, memo)
    VALUES (${IDS.supplier}, '공급사', 'SRC', '010-private', 'private@example.com', 'private-bank', 'private-note')
  `;
  await sql`INSERT INTO product_masters (id) VALUES (${IDS.master})`;
  await sql`
    INSERT INTO product_master_versions (id, master_id, version, status, name, product_code, fulfillment_kind)
    VALUES (${IDS.version}, ${IDS.master}, 1, 'active', '실제 세트 상품', 'REAL-SET', 'physical')
  `;
  await sql`
    INSERT INTO product_variants (id, variant_name, status, is_default, variant_code)
    VALUES (${IDS.variant}, '실제 세트 품목', 'active', true, 'REAL-SET-V')
  `;
  await sql`
    INSERT INTO product_master_variants (id, master_id, variant_id, version_id)
    VALUES (${IDS.masterVariant}, ${IDS.master}, ${IDS.variant}, ${IDS.version})
  `;
  await sql`
    INSERT INTO skus (id, holder_id, name, code, stock_type, is_deleted, deleted_at)
    VALUES
      (${IDS.skuA}, ${IDS.holder}, '구성 A', 'SRC-A', 'physical', false, null),
      (${IDS.skuB}, ${IDS.holder}, '구성 B', 'SRC-B', 'physical', false, null),
      (${IDS.skuUnlinked}, ${IDS.holder}, '연결 없는 삭제 SKU', 'SRC-C', 'physical', true, now())
  `;
  await sql`
    INSERT INTO sku_barcodes (id, sku_id, barcode, is_primary, packing_unit)
    VALUES
      (${IDS.barcodeA}, ${IDS.skuA}, '8800000000001', true, 1),
      (${IDS.barcodeB}, ${IDS.skuB}, '8800000000002', true, 12),
      (${IDS.barcodeUnlinked}, ${IDS.skuUnlinked}, '8800000000003', true, 24)
  `;
  await sql`
    INSERT INTO sku_suppliers (sku_id, supplier_id, supplier_sku)
    VALUES (${IDS.skuA}, ${IDS.supplier}, 'SUP-A'), (${IDS.skuB}, ${IDS.supplier}, 'SUP-B')
  `;
  await sql`
    INSERT INTO product_matchings (id, variant_id, master_id, status, strategy, is_resolved)
    VALUES (${IDS.matching}, ${IDS.variant}, ${IDS.master}, 'matched', 'variant', true)
  `;
  await sql`
    INSERT INTO product_variant_sku_links (product_matching_id, sku_id, quantity)
    VALUES (${IDS.matching}, ${IDS.skuA}, 2), (${IDS.matching}, ${IDS.skuB}, 1)
  `;
}

async function seedTarget(sql: Sql): Promise<void> {
  const fixtureSku = DEMO_LOGISTICS_FIXTURE.catalog[0];
  await sql`INSERT INTO holders (id, name, is_our_asset) VALUES (${DEMO_FIXTURE_HOLDER_ID}, 'demo holder', true)`;
  await sql`
    INSERT INTO delivery_profiles (id, name, source_type, carrier_account_ref)
    VALUES (${DEMO_LOGISTICS_FIXTURE.deliveryProfile.id}, 'demo profile', 'in_house', 'demo-mock')
  `;
  await sql`
    INSERT INTO warehouses (id, name, type, is_sellable)
    VALUES (${DEMO_LOGISTICS_FIXTURE.warehouses[0].id}, 'demo warehouse', 'domestic', true)
  `;
  await sql`
    INSERT INTO suppliers (id, name, code, default_warehouse_id)
    VALUES (
      ${DEMO_LOGISTICS_FIXTURE.suppliers[0].id}, ${DEMO_LOGISTICS_FIXTURE.suppliers[0].name},
      ${DEMO_LOGISTICS_FIXTURE.suppliers[0].code}, ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id}
    )
  `;
  await sql`
    INSERT INTO locations (id, warehouse_id, code, location_type, display_name, is_active)
    VALUES (
      ${DEMO_LOGISTICS_FIXTURE.locations[2].id}, ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id},
      'DEMO-A-01-01', 'zone', 'A-01-01', true
    )
  `;
  await sql`
    INSERT INTO skus (id, holder_id, name, code, stock_type, delivery_profile_id, primary_location_id)
    VALUES (
      ${fixtureSku.skuId}, ${DEMO_FIXTURE_HOLDER_ID}, ${fixtureSku.productName}, ${fixtureSku.sku}, 'physical',
      ${DEMO_LOGISTICS_FIXTURE.deliveryProfile.id}, ${DEMO_LOGISTICS_FIXTURE.locations[2].id}
    )
  `;
  await sql`
    INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty, version)
    VALUES (
      ${fixtureSku.skuId}, ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id},
      ${DEMO_LOGISTICS_FIXTURE.locations[2].id}, 'ON_HAND', 17, 3
    )
  `;
  await sql`
    INSERT INTO movement_jobs (id, warehouse_id, occurred_at, total_quantity, memo)
    VALUES (${IDS.movementJob}, ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id}, now(), 5, 'existing work')
  `;
  await sql`
    INSERT INTO movement_work_logs (id, job_id, sku_id, warehouse_id, quantity, reason)
    VALUES (
      ${IDS.movementWork}, ${IDS.movementJob}, ${fixtureSku.skuId},
      ${DEMO_LOGISTICS_FIXTURE.warehouses[0].id}, 5, 'existing work'
    )
  `;
}

async function operationalState(sql: Sql): Promise<unknown> {
  const [row] = await sql<{ stock: unknown; work: unknown }[]>`
    SELECT
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sku_id) FROM stock_ledgers s) AS stock,
      (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM movement_work_logs w) AS work
  `;
  return row;
}

describeIfDatabase('catalog import against disposable migrated PostgreSQL', () => {
  jest.setTimeout(180_000);
  let source: Sql;
  let target: Sql;
  let sourceServer: Awaited<ReturnType<typeof serverIdentity>>;
  let targetServer: Awaited<ReturnType<typeof serverIdentity>>;

  beforeAll(async () => {
    if (identityFromUrl(SOURCE_URL!).database !== 'demo_training_import_source')
      throw new Error('unsafe source test DB');
    if (identityFromUrl(TARGET_URL!).database !== 'demo_training_import_target')
      throw new Error('unsafe target test DB');
    source = postgres(SOURCE_URL!, { max: 1, prepare: false, onnotice: () => undefined });
    target = postgres(TARGET_URL!, { max: 1, prepare: false, onnotice: () => undefined });
    sourceServer = await serverIdentity(source);
    targetServer = await serverIdentity(target);
    await seedSource(source);
    await seedTarget(target);
  });

  afterAll(async () => {
    await source?.end();
    await target?.end();
  });

  it('runs twice without changing stock/work and retains exact SKU IDs, deletion, packing units, sets and metadata', async () => {
    const snapshot = await readCatalogSnapshot(source, sourceServer, 'live');
    expect(snapshot.manifest.skuIds).toEqual([IDS.skuA, IDS.skuB, IDS.skuUnlinked]);
    expect(snapshot.tables.suppliers[0]).not.toHaveProperty('phone');
    expect(snapshot.tables.suppliers[0]).not.toHaveProperty('bank_account_no');

    const before = await operationalState(target);
    const dryRun = await importCatalogSnapshot(target, snapshot, {
      stage: 'demo',
      externalIntegrationsMode: 'mock',
      expectedTarget: targetServer,
      connectedTarget: identityFromUrl(TARGET_URL!),
      expectedConnectedTarget: identityFromUrl(TARGET_URL!),
    });
    expect(dryRun.mode).toBe('dry-run');
    expect(dryRun.syntheticCatalogLinks).toHaveLength(1);
    expect(dryRun.missingSourceSkuIds).toEqual(snapshot.manifest.skuIds);
    expect(await target`SELECT to_regclass('demo_catalog_imports') AS table_name`).toEqual([
      expect.objectContaining({ table_name: null }),
    ]);

    const first = await importCatalogSnapshot(target, snapshot, {
      stage: 'demo',
      externalIntegrationsMode: 'mock',
      expectedTarget: targetServer,
      connectedTarget: identityFromUrl(TARGET_URL!),
      expectedConnectedTarget: identityFromUrl(TARGET_URL!),
      apply: true,
      batchSize: 2,
    });
    const afterFirst = await operationalState(target);
    const second = await importCatalogSnapshot(target, snapshot, {
      stage: 'demo',
      externalIntegrationsMode: 'mock',
      expectedTarget: targetServer,
      connectedTarget: identityFromUrl(TARGET_URL!),
      expectedConnectedTarget: identityFromUrl(TARGET_URL!),
      apply: true,
      batchSize: 2,
    });
    const afterSecond = await operationalState(target);

    expect(first.missingSourceSkuIds).toEqual([]);
    expect(second.missingSourceSkuIds).toEqual([]);
    expect(second.deletedStatusMismatchSkuIds).toEqual([]);
    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(before);

    const importedSkus = await target<{ id: string; is_deleted: boolean; holder_id: string }[]>`
      SELECT id::text, is_deleted, holder_id::text FROM skus
      WHERE id = ANY(${snapshot.manifest.skuIds}::uuid[]) ORDER BY id
    `;
    expect(importedSkus).toEqual([
      { id: IDS.skuA, is_deleted: false, holder_id: DEMO_FIXTURE_HOLDER_ID },
      { id: IDS.skuB, is_deleted: false, holder_id: DEMO_FIXTURE_HOLDER_ID },
      { id: IDS.skuUnlinked, is_deleted: true, holder_id: DEMO_FIXTURE_HOLDER_ID },
    ]);
    expect(await target`SELECT barcode, packing_unit FROM sku_barcodes ORDER BY barcode`).toEqual([
      { barcode: '8800000000001', packing_unit: 1 },
      { barcode: '8800000000002', packing_unit: 12 },
      { barcode: '8800000000003', packing_unit: 24 },
    ]);
    expect(
      await target`SELECT sku_id::text, quantity FROM product_variant_sku_links WHERE product_matching_id = ${IDS.matching} ORDER BY sku_id`,
    ).toEqual([
      { sku_id: IDS.skuA, quantity: 2 },
      { sku_id: IDS.skuB, quantity: 1 },
    ]);

    const fallback = deterministicCatalogIds(IDS.skuUnlinked);
    expect(await target`SELECT status FROM product_variants WHERE id = ${fallback.variantId}`).toEqual([
      { status: 'inactive' },
    ]);
    const [metadata] = await target<{ source_sku_ids: string[]; imported_sku_ids: string[] }[]>`
      SELECT source_sku_ids, imported_sku_ids FROM demo_catalog_imports
      WHERE snapshot_id = ${snapshot.manifest.contentSha256}
    `;
    expect(metadata.source_sku_ids).toEqual(snapshot.manifest.skuIds);
    expect(metadata.imported_sku_ids).toEqual(snapshot.manifest.skuIds);
  });
});
