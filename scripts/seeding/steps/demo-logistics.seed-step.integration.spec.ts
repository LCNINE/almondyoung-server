// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { DEMO_LOGISTICS_FIXTURE as fixture, demoUuid } from './demo-logistics.fixture';
import { DemoLogisticsSeedStep, toDemoRuntimeDatabaseUrl } from './demo-logistics.seed-step';

const describeDb = process.env.REQUIRE_DEMO_LOGISTICS_SEED_DB === '1' ? describe : describe.skip;
const BASELINE_SELLABLE_WAREHOUSE = '019d0001-0001-7000-a000-000000000001';

describeDb('DemoLogisticsSeedStep baseline convergence', () => {
  const databaseUrl = process.env.DEMO_LOGISTICS_SEED_DATABASE_URL!;
  const sql = postgres(toDemoRuntimeDatabaseUrl(databaseUrl));
  const previousStage = process.env.SST_STAGE;

  beforeAll(() => {
    process.env.SST_STAGE = 'demo';
  });

  afterAll(async () => {
    if (previousStage === undefined) delete process.env.SST_STAGE;
    else process.env.SST_STAGE = previousStage;
    await sql.end();
  });

  it('repairs an already-seeded baseline plus stale demo fixture and stays idempotent', async () => {
    await sql`UPDATE warehouses SET is_sellable = true WHERE id IN (${BASELINE_SELLABLE_WAREHOUSE}, ${fixture.warehouses[0].id})`;
    await sql`
      UPDATE suppliers
      SET default_warehouse_id = ${fixture.warehouses[0].id}
      WHERE id = ANY(${fixture.suppliers.map((supplier) => supplier.id)})
    `;
    await sql`
      UPDATE purchase_orders
      SET type = 'domestic', source_warehouse_id = ${fixture.warehouses[0].id},
          destination_warehouse_id = ${fixture.warehouses[0].id}, requires_transfer = false
      WHERE id = ANY(${Array.from({ length: 15 }, (_, index) => demoUuid(9, 201 + index))})
    `;
    await sql`
      UPDATE skus SET delivery_profile_id = NULL
      WHERE id = ANY(${fixture.catalog.map((item) => item.skuId)})
    `;

    const step = new DemoLogisticsSeedStep(databaseUrl);
    try {
      await expect(step.check()).resolves.toMatchObject({ isFullySeeded: false });
      await expect(step.apply()).resolves.toMatchObject({ success: true });
      await expect(step.check()).resolves.toMatchObject({ isFullySeeded: true });

      await sql`
        UPDATE inbound_receipt_lines
        SET putaway_from_origin_qty = 0
        WHERE id = ANY(${Array.from({ length: 15 }, (_, index) => demoUuid(9, 401 + index))})
      `;
      await expect(step.check()).resolves.toMatchObject({ isFullySeeded: false });
      await expect(step.apply()).resolves.toMatchObject({ success: true });
      await expect(step.check()).resolves.toMatchObject({ isFullySeeded: true });
      await expect(step.apply()).resolves.toMatchObject({ success: true });
      await expect(step.check()).resolves.toMatchObject({ isFullySeeded: true });
    } finally {
      await step.dispose();
    }

    const [sellable] = await sql`SELECT count(*)::int AS count FROM warehouses WHERE is_sellable`;
    const [foreignRoutes] = await sql`
      SELECT count(*)::int AS count
      FROM purchase_orders
      WHERE id = ANY(${Array.from({ length: 15 }, (_, index) => demoUuid(9, 201 + index))})
        AND type = 'foreign' AND source_warehouse_id = ${fixture.warehouses[1].id}
        AND destination_warehouse_id = ${fixture.warehouses[0].id} AND requires_transfer
    `;
    expect(Number(sellable.count)).toBe(1);
    expect(Number(foreignRoutes.count)).toBe(10);
    const [profiledSkus] = await sql`
      SELECT count(*)::int AS count
      FROM skus
      WHERE id = ANY(${fixture.catalog.map((item) => item.skuId)})
        AND delivery_profile_id = ${fixture.deliveryProfile.id}
    `;
    expect(Number(profiledSkus.count)).toBe(30);
    const [settledHistoricalReceipts] = await sql`
      SELECT count(*)::int AS count
      FROM inbound_receipt_lines
      WHERE id = ANY(${Array.from({ length: 15 }, (_, index) => demoUuid(9, 401 + index))})
        AND putaway_from_origin_qty = quantity
    `;
    expect(Number(settledHistoricalReceipts.count)).toBe(15);
  });
});
