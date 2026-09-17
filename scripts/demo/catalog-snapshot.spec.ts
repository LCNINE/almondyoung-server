import { CATALOG_TABLES, assertSnapshot, emptyCatalogTables, type CatalogSnapshot } from './catalog-policy';
import { assertLiveSource, buildSnapshotSelect, snapshotFromRows } from './catalog-snapshot';

describe('catalog snapshot export', () => {
  it('builds SELECT statements only from the explicit table and column policy', () => {
    const suppliers = CATALOG_TABLES.find((table) => table.name === 'suppliers')!;
    expect(buildSnapshotSelect(suppliers)).toBe(
      'SELECT "id", "name", "code", "is_direct_delivery", "order_cutoff_time", "payment_method", ' +
        '"created_at"::text AS "created_at", "updated_at"::text AS "updated_at" FROM "suppliers" ORDER BY "id"',
    );
    expect(buildSnapshotSelect(suppliers)).not.toMatch(/email|phone|bank|memo|manager/i);
  });

  it('exports naive timestamps as database text to preserve wall time and microseconds', () => {
    const masters = CATALOG_TABLES.find((table) => table.name === 'product_masters')!;
    expect(buildSnapshotSelect(masters)).toBe(
      'SELECT "id", "created_at"::text AS "created_at", "deleted_at"::text AS "deleted_at" FROM "product_masters" ORDER BY "id"',
    );
  });

  it('rejects a source transaction that is writable or is not explicitly bound to live', () => {
    expect(() =>
      assertLiveSource(
        { stage: 'live', database: 'core', host: '127.0.0.1', port: 5432, readOnly: false },
        { database: 'core', host: '127.0.0.1', port: 5432 },
      ),
    ).toThrow(/read.only/i);
    expect(() =>
      assertLiveSource(
        { stage: 'demo', database: 'core', host: '127.0.0.1', port: 5432, readOnly: true },
        { database: 'core', host: '127.0.0.1', port: 5432 },
      ),
    ).toThrow(/live/i);
    expect(() =>
      assertLiveSource(
        { stage: 'live', database: 'core', host: '10.0.99.99', port: 5432, readOnly: true },
        { database: 'core', host: '10.0.13.14', port: 5432 },
      ),
    ).toThrow(/binding/i);
  });

  it('creates exact counts and verifiable hashes from allowlisted rows', () => {
    const tables = emptyCatalogTables();
    tables.skus.push({
      id: '11111111-1111-4111-8111-111111111111',
      group_id: null,
      option_key: null,
      name: '상품',
      code: 'SKU-1',
      stock_type: 'physical',
      safety_stock: 0,
      business_product_name: null,
      logistics_partner_id: null,
      discount: null,
      manufacturer_star: null,
      product_weight: 10,
      dimension_width: null,
      dimension_height: null,
      dimension_depth: null,
      product_material: null,
      korean_name: '상품',
      max_discount_quantity: null,
      packaging_importer_name: null,
      product_description: null,
      moq: 1,
      main_image_url: null,
      expiry_date_management: false,
      expiry_start_date: null,
      expiry_end_date: null,
      manufacturing_date_management: false,
      is_general_inventory: true,
      validity_start_date: null,
      validity_end_date: null,
      variant_group_code: null,
      is_deleted: false,
      deleted_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const snapshot = snapshotFromRows(
      tables,
      { stage: 'live', database: 'core', host: '127.0.0.1', port: 5432, readOnly: true },
      '2026-09-17T00:00:00.000Z',
    );

    expect(snapshot.manifest.counts.skus).toBe(1);
    expect(snapshot.manifest.skuIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(snapshot.manifest.skuIdSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.manifest.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the content hash valid after database Date values cross the JSON artifact boundary', () => {
    const tables = emptyCatalogTables();
    tables.product_masters.push({
      id: '11111111-1111-4111-8111-111111111111',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      deleted_at: null,
    });
    const snapshot = snapshotFromRows(
      tables,
      { stage: 'live', database: 'core', host: '10.0.13.14', port: 5432, readOnly: true },
      '2026-09-17T00:00:00.000Z',
    );

    expect(() => assertSnapshot(JSON.parse(JSON.stringify(snapshot)) as CatalogSnapshot)).not.toThrow();
  });

  it('nulls a nullable orphan matching master and records exact normalization provenance', () => {
    const tables = emptyCatalogTables();
    tables.product_variants.push({ id: '11111111-1111-4111-8111-111111111111' });
    tables.product_matchings.push({
      id: '22222222-2222-4222-8222-222222222222',
      variant_id: '11111111-1111-4111-8111-111111111111',
      master_id: '33333333-3333-4333-8333-333333333333',
      sku_group_id: null,
    });

    const snapshot = snapshotFromRows(
      tables,
      { stage: 'live', database: 'core', host: '10.0.13.14', port: 5432, readOnly: true },
      '2026-09-17T00:00:00.000Z',
    );

    expect(snapshot.tables.product_matchings[0].master_id).toBeNull();
    expect(snapshot.manifest.normalizations).toEqual([
      expect.objectContaining({
        table: 'product_matchings',
        column: 'master_id',
        parentTable: 'product_masters',
        count: 1,
        rowIds: ['22222222-2222-4222-8222-222222222222'],
        referencedIds: ['33333333-3333-4333-8333-333333333333'],
      }),
    ]);
  });
});
