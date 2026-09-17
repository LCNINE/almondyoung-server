import { emptyCatalogTables, finalizeSnapshot, type CatalogSnapshot } from './catalog-policy';
import {
  assertSnapshotIsCurrent,
  buildCatalogAnalyzeSql,
  buildSetBasedUpsert,
  withTrainingFallbacks,
} from './catalog-import';

function snapshotWithRows(): CatalogSnapshot {
  const tables = emptyCatalogTables();
  tables.skus.push(
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: '세트 A',
      code: 'A',
      stock_type: 'physical',
      is_deleted: false,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: '세트 B',
      code: 'B',
      stock_type: 'physical',
      is_deleted: false,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: '연결 없음',
      code: 'C',
      stock_type: 'physical',
      is_deleted: true,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: '무한재고',
      code: 'D',
      stock_type: 'infinite',
      is_deleted: false,
    },
  );
  tables.product_masters.push({ id: '55555555-5555-4555-8555-555555555555' });
  tables.product_master_versions.push({
    id: '66666666-6666-4666-8666-666666666666',
    master_id: '55555555-5555-4555-8555-555555555555',
    parent_version_id: null,
    version: 1,
    status: 'active',
    fulfillment_kind: 'physical',
    name: '실제 세트',
  });
  tables.product_variants.push({ id: '77777777-7777-4777-8777-777777777777', status: 'active' });
  tables.product_master_variants.push({
    id: '88888888-8888-4888-8888-888888888888',
    master_id: '55555555-5555-4555-8555-555555555555',
    version_id: '66666666-6666-4666-8666-666666666666',
    variant_id: '77777777-7777-4777-8777-777777777777',
  });
  tables.product_matchings.push({
    id: '99999999-9999-4999-8999-999999999999',
    variant_id: '77777777-7777-4777-8777-777777777777',
    master_id: '55555555-5555-4555-8555-555555555555',
    status: 'matched',
    is_resolved: true,
  });
  tables.product_variant_sku_links.push(
    {
      product_matching_id: '99999999-9999-4999-8999-999999999999',
      sku_id: '11111111-1111-4111-8111-111111111111',
      quantity: 2,
    },
    {
      product_matching_id: '99999999-9999-4999-8999-999999999999',
      sku_id: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    },
  );
  return finalizeSnapshot({
    manifest: {
      schemaVersion: 1,
      generatedAt: '2026-09-17T00:00:00.000Z',
      source: { stage: 'live', database: 'live_core', host: 'live-db', port: 5432, readOnly: true },
      skuIds: [],
      skuIdSha256: '',
      counts: {},
      normalizations: [],
      contentSha256: '',
    },
    tables,
  });
}

describe('catalog import planning', () => {
  it('retains real set links and creates one deterministic fallback only for an unlinked physical SKU', () => {
    const { tables, synthetic, demoSupplierFallbackSkuIds } = withTrainingFallbacks(snapshotWithRows());

    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({
      skuId: '33333333-3333-4333-8333-333333333333',
      sourceDeleted: true,
    });
    expect(tables.product_variant_sku_links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku_id: '11111111-1111-4111-8111-111111111111', quantity: 2 }),
        expect.objectContaining({ sku_id: '22222222-2222-4222-8222-222222222222', quantity: 1 }),
        expect.objectContaining({ sku_id: '33333333-3333-4333-8333-333333333333', quantity: 1 }),
      ]),
    );
    expect(tables.product_master_versions.at(-1)).toMatchObject({ status: 'inactive', fulfillment_kind: 'physical' });
    expect(tables.product_variants.at(-1)).toMatchObject({ status: 'inactive' });
    expect(demoSupplierFallbackSkuIds).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(tables.sku_suppliers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku_id: '11111111-1111-4111-8111-111111111111',
          supplier_id: '019f1008-0001-7000-a000-000000000001',
        }),
      ]),
    );
    expect(tables.product_master_versions.at(-1)).toMatchObject({ supply_price: '10000' });
  });

  it('adds fallbacks for physical SKUs whose real set only reaches an inactive version', () => {
    const snapshot = snapshotWithRows();
    snapshot.tables.product_master_versions[0].status = 'inactive';

    const { tables, synthetic } = withTrainingFallbacks(snapshot);

    expect(synthetic.map((row) => row.skuId).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(
      tables.product_variant_sku_links.filter(
        (row) => row.product_matching_id === '99999999-9999-4999-8999-999999999999',
      ),
    ).toHaveLength(2);
  });

  it('builds one set-based upsert per table and keeps operational tables outside the SQL', () => {
    const sql = buildSetBasedUpsert('sku_barcodes');
    expect(sql).toContain('jsonb_to_recordset($1::jsonb)');
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(sql).toContain('"created_at" = EXCLUDED."created_at"');
    expect(sql).toContain('"packing_unit" = EXCLUDED."packing_unit"');
    expect(sql).not.toMatch(/stock_|reservation|order|work/i);
  });

  it('analyzes only allowlisted catalog tables', () => {
    const sql = buildCatalogAnalyzeSql();
    expect(sql).toMatch(/^ANALYZE "suppliers"/);
    expect(sql).toContain('"skus"');
    expect(sql).toContain('"product_variant_sku_links"');
    expect(sql).not.toMatch(/stock_ledgers|orders|work_logs|reservations/);
  });

  it('rejects an older extraction even when the live server host changed after failover', () => {
    const snapshot = snapshotWithRows();
    snapshot.manifest.source.host = 'new-live-host';
    expect(() =>
      assertSnapshotIsCurrent(snapshot, {
        source_generated_at: '2026-09-18T00:00:00.000Z',
        source_relation_keys: null,
        demo_supplier_fallback_sku_ids: null,
      }),
    ).toThrow('Snapshot is older');
  });
});
