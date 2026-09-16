import { DEMO_LOGISTICS_FIXTURE, demoUuid } from './demo-logistics.fixture';
import { DemoLogisticsSeedStep, toDemoRuntimeDatabaseUrl } from './demo-logistics.seed-step';

describe('demo logistics fixture contract', () => {
  it('removes drizzle-kit-only parameters before the recompute runtime opens postgres.js', () => {
    expect(
      toDemoRuntimeDatabaseUrl(
        'postgresql://demo:secret@db.example.com:5432/core?sslmode=require&uselibpqcompat=true',
      ),
    ).toBe('postgresql://demo:secret@db.example.com:5432/core?sslmode=require');
  });

  it('requires derived demand and supplier profiles so a failed recompute is retried', async () => {
    class CheckHarness extends DemoLogisticsSeedStep {
      constructor() {
        super('postgresql://demo:secret@localhost:5432/core');
        this.client = (async (parts: TemplateStringsArray | string) => {
          if (typeof parts === 'string') return parts;
          const query = parts.join('');
          if (query.includes('FROM sku_demand_daily')) return [{ count: 30 * DEMO_LOGISTICS_FIXTURE.demandDays }];
          if (query.includes('FROM purchase_orders')) return [{ count: 15 }];
          if (query.includes('FROM sku_demand_profiles')) return [{ count: 0 }];
          if (query.includes('FROM supplier_lead_time_profiles')) return [{ count: 0 }];
          throw new Error(`Unexpected query: ${query}`);
        }) as unknown as typeof this.client;
      }

      protected async findExistingIds(table: string, ids: string[]): Promise<Set<string>> {
        return new Set(ids);
      }
    }

    const result = await new CheckHarness().check();

    expect(result.isFullySeeded).toBe(false);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'sku_demand_profiles', expected: 30, existing: 0, missing: 30 }),
        expect.objectContaining({ entity: 'supplier_lead_time_profiles', expected: 3, existing: 0, missing: 3 }),
      ]),
    );
  });

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
