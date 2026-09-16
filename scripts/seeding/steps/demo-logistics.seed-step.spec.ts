import { DEMO_LOGISTICS_FIXTURE, demoUuid } from './demo-logistics.fixture';

describe('demo logistics fixture contract', () => {
  it('publishes 30 deterministic catalog items with the agreed channel UUID mapping', () => {
    expect(DEMO_LOGISTICS_FIXTURE.catalog).toHaveLength(30);
    expect(DEMO_LOGISTICS_FIXTURE.catalog[0]).toMatchObject({
      masterId: '019f1001-0001-7000-a000-000000000001',
      versionId: '019f1002-0001-7000-a000-000000000001',
      variantId: '019f1003-0001-7000-a000-000000000001',
      skuId: '019f1004-0001-7000-a000-000000000001',
      sku: 'DEMO-SKU-001',
      productName: '데모 물류 상품 01',
      unitPrice: 10_000,
    });
    expect(demoUuid(3, 30)).toBe('019f1003-0030-7000-a000-000000000030');
    expect(new Set(DEMO_LOGISTICS_FIXTURE.catalog.map((item) => item.variantId)).size).toBe(30);
  });

  it('contains the required warehouses, suppliers, demand window and lead-time samples', () => {
    expect(DEMO_LOGISTICS_FIXTURE.warehouses).toHaveLength(2);
    expect(DEMO_LOGISTICS_FIXTURE.suppliers).toHaveLength(3);
    expect(DEMO_LOGISTICS_FIXTURE.locations.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_LOGISTICS_FIXTURE.demandDays).toBe(365);
    for (const supplier of DEMO_LOGISTICS_FIXTURE.suppliers) {
      expect(supplier.leadTimeDays).toHaveLength(5);
    }
  });
});
