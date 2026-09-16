import {
  CATALOG_TABLES,
  assertDemoTarget,
  assertSnapshot,
  deterministicCatalogIds,
  type CatalogSnapshot,
} from './catalog-policy';

const SKU_ID = '11111111-1111-4111-8111-111111111111';

function minimalSnapshot(): CatalogSnapshot {
  return {
    manifest: {
      schemaVersion: 1,
      generatedAt: '2026-09-17T00:00:00.000Z',
      source: { stage: 'live', database: 'live_core', host: 'live-db', port: 5432, readOnly: true },
      skuIds: [SKU_ID],
      skuIdSha256: 'pending',
      counts: { skus: 1 },
      normalizations: [],
      contentSha256: 'pending',
    },
    tables: Object.fromEntries(CATALOG_TABLES.map((table) => [table.name, []])) as unknown as CatalogSnapshot['tables'],
  };
}

describe('catalog demo safety policy', () => {
  it('rejects a live target even when its database name contains demo', () => {
    expect(() =>
      assertDemoTarget({
        stage: 'live',
        externalIntegrationsMode: 'mock',
        actual: { database: 'demo_core', host: 'demo-db', port: 5432 },
        expected: { database: 'demo_core', host: 'demo-db', port: 5432 },
        fixtureRows: 5,
      }),
    ).toThrow(/stage/i);
  });

  it.each([
    ['database', { database: 'wrong', host: 'demo-db', port: 5432 }],
    ['host', { database: 'demo_core', host: 'wrong', port: 5432 }],
    ['port', { database: 'demo_core', host: 'demo-db', port: 6543 }],
  ])('rejects an actual target whose %s does not match the explicit binding', (_field, actual) => {
    expect(() =>
      assertDemoTarget({
        stage: 'demo',
        externalIntegrationsMode: 'mock',
        actual,
        expected: { database: 'demo_core', host: 'demo-db', port: 5432 },
        fixtureRows: 5,
      }),
    ).toThrow(/binding/i);
  });

  it('rejects a target without the demo fixture identity independently of environment variables', () => {
    expect(() =>
      assertDemoTarget({
        stage: 'demo',
        externalIntegrationsMode: 'mock',
        actual: { database: 'demo_core', host: 'demo-db', port: 5432 },
        expected: { database: 'demo_core', host: 'demo-db', port: 5432 },
        fixtureRows: 3,
      }),
    ).toThrow(/fixture/i);
  });

  it('keeps private supplier and staff fields outside every export allowlist', () => {
    const exported = new Set(CATALOG_TABLES.flatMap((table) => table.columns.map((column) => column.name)));
    for (const forbidden of [
      'phone',
      'fax',
      'email',
      'business_reg_no',
      'ceo_name',
      'bank_account_no',
      'bank_account_holder',
      'purchase_manager_id',
      'memo',
      'memo2',
      'memo3',
      'created_by',
      'updated_by',
      'deleted_by',
      'draft_owner_id',
    ]) {
      expect(exported.has(forbidden)).toBe(false);
    }
  });

  it('keeps real price rules while excluding sales-channel credential tables', () => {
    expect(CATALOG_TABLES.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'pricing_rules',
        'product_master_pricing_rules',
        'product_variant_price_cache',
        'supplier_lead_time_profiles',
        'replenishment_supplier_rules',
      ]),
    );
    expect(CATALOG_TABLES.map((table) => table.name)).not.toEqual(
      expect.arrayContaining(['sales_channels', 'channel_variant_listings']),
    );
  });

  it('rejects undeclared columns even if they are injected into a known table', () => {
    const snapshot = minimalSnapshot();
    snapshot.tables.skus.push({
      id: SKU_ID,
      name: '테스트 SKU',
      code: 'SKU-1',
      stock_type: 'physical',
      is_deleted: false,
      memo2: 'private note',
    });

    expect(() => assertSnapshot(snapshot)).toThrow(/memo2/);
  });

  it('rejects a manifest whose exact SKU identifier set differs from its rows', () => {
    const snapshot = minimalSnapshot();
    snapshot.manifest.skuIds = ['22222222-2222-4222-8222-222222222222'];
    snapshot.tables.skus.push({
      id: SKU_ID,
      name: '테스트 SKU',
      code: 'SKU-1',
      stock_type: 'physical',
      is_deleted: false,
    });

    expect(() => assertSnapshot(snapshot, { verifyHashes: false })).toThrow(/SKU identifier/i);
  });

  it('rejects a relationship whose SKU is absent from the exact source set', () => {
    const snapshot = minimalSnapshot();
    snapshot.tables.skus.push({
      id: SKU_ID,
      name: '테스트 SKU',
      code: 'SKU-1',
      stock_type: 'physical',
      is_deleted: false,
    });
    snapshot.tables.sku_barcodes.push({
      id: '33333333-3333-4333-8333-333333333333',
      sku_id: '22222222-2222-4222-8222-222222222222',
      barcode: '880000000001',
      is_primary: true,
      packing_unit: 1,
    });

    expect(() => assertSnapshot(snapshot, { verifyHashes: false })).toThrow(/sku_barcodes.*sku_id/i);
  });

  it('derives stable, distinct UUIDs for a missing physical catalog link', () => {
    expect(deterministicCatalogIds(SKU_ID)).toEqual({
      masterId: '91938dae-98f7-5bf7-bf5e-d47f8495ac9a',
      versionId: 'a604a4d0-c976-536e-8a47-661e4c9af7e8',
      variantId: 'ce2f10ff-f6a6-53e5-8f25-ecf863f4b38d',
      masterVariantId: '0d59a901-0d80-5d22-8233-c2010c9b6814',
      matchingId: '2526ce23-026f-59d8-8d11-faa3ded6d259',
    });
  });
});
