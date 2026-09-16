import { Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { inventorySchema, inventoryTables } from '../inventory/schema/inventory.schema';
import { ReplenishmentProfileService } from '../inventory/replenishment/demand/replenishment-profile.service';
import {
  DEMO_LOGISTICS_FIXTURE,
  DEMO_LOGISTICS_FIXTURE_VERSION,
} from '../../../../../scripts/seeding/steps/demo-logistics.fixture';

interface CountRow {
  products: number | string;
  variants: number | string;
  skus: number | string;
  suppliers: number | string;
  warehouses: number | string;
  locations: number | string;
  demand_days: number | string;
  lead_time_observations: number | string;
  recomputed_at: Date | string | null;
}

@Injectable()
export class DemoService {
  constructor(
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
    private readonly profiles: ReplenishmentProfileService,
  ) {}

  async catalog() {
    const fixture = DEMO_LOGISTICS_FIXTURE;
    return this.dbService.run(async (trx) => {
      const skuIds = fixture.catalog.map((item) => item.skuId);
      const existingSkus = await trx
        .select({ id: inventoryTables.skus.id })
        .from(inventoryTables.skus)
        .where(inArray(inventoryTables.skus.id, skuIds));
      const available = await trx
        .select({
          skuId: inventoryTables.stockLedgers.skuId,
          quantity: sql<number>`coalesce(sum(${inventoryTables.stockLedgers.qty}), 0)::int`,
        })
        .from(inventoryTables.stockLedgers)
        .where(inArray(inventoryTables.stockLedgers.skuId, skuIds))
        .groupBy(inventoryTables.stockLedgers.skuId);
      const existing = new Set(existingSkus.map((row) => row.id));
      const quantities = new Map(available.map((row) => [row.skuId, Number(row.quantity)]));
      return {
        fixtureVersion: DEMO_LOGISTICS_FIXTURE_VERSION,
        items: fixture.catalog
          .filter((item) => existing.has(item.skuId))
          .map((item) => ({
            variantId: item.variantId,
            masterId: item.masterId,
            versionId: item.versionId,
            skuId: item.skuId,
            sku: item.sku,
            productName: item.productName,
            unitPrice: item.unitPrice,
            availableQuantity: quantities.get(item.skuId) ?? 0,
          })),
      };
    });
  }

  async readiness() {
    const ids = DEMO_LOGISTICS_FIXTURE.catalog.map((item) => item.skuId);
    const variantIds = DEMO_LOGISTICS_FIXTURE.catalog.map((item) => item.variantId);
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(sql`
        SELECT
          (SELECT count(*) FROM product_masters WHERE id IN (${sql.join(
            DEMO_LOGISTICS_FIXTURE.catalog.map((item) => sql`${item.masterId}`),
            sql`, `,
          )}))::int AS products,
          (SELECT count(*) FROM product_variants WHERE id IN (${sql.join(
            variantIds.map((id) => sql`${id}`),
            sql`, `,
          )}))::int AS variants,
          (SELECT count(*) FROM skus WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}))::int AS skus,
          (SELECT count(*) FROM suppliers WHERE id IN (${sql.join(
            DEMO_LOGISTICS_FIXTURE.suppliers.map((item) => sql`${item.id}`),
            sql`, `,
          )}))::int AS suppliers,
          (SELECT count(*) FROM warehouses WHERE id IN (${sql.join(
            DEMO_LOGISTICS_FIXTURE.warehouses.map((item) => sql`${item.id}`),
            sql`, `,
          )}))::int AS warehouses,
          (SELECT count(*) FROM locations WHERE id IN (${sql.join(
            DEMO_LOGISTICS_FIXTURE.locations.map((item) => sql`${item.id}`),
            sql`, `,
          )}))::int AS locations,
          (SELECT count(DISTINCT demand_date) FROM sku_demand_daily WHERE sku_id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}))::int AS demand_days,
          (SELECT coalesce(sum(observations), 0) FROM supplier_lead_time_profiles WHERE supplier_id IN (${sql.join(
            DEMO_LOGISTICS_FIXTURE.suppliers.map((item) => sql`${item.id}`),
            sql`, `,
          )}))::int AS lead_time_observations,
          (SELECT max(computed_at) FROM sku_demand_profiles WHERE sku_id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})) AS recomputed_at
      `);
      const row = (result as unknown as CountRow[])[0];
      const counts = {
        products: Number(row.products),
        variants: Number(row.variants),
        skus: Number(row.skus),
        suppliers: Number(row.suppliers),
        warehouses: Number(row.warehouses),
        locations: Number(row.locations),
        demandDays: Number(row.demand_days),
        leadTimeObservations: Number(row.lead_time_observations),
      };
      const expected = {
        products: 30,
        variants: 30,
        skus: 30,
        suppliers: 3,
        warehouses: 2,
        locations: DEMO_LOGISTICS_FIXTURE.locations.length,
        demandDays: 365,
        leadTimeObservations: 15,
      };
      const checks = Object.entries(expected).map(([key, minimum]) => ({
        key,
        ready: counts[key as keyof typeof counts] >= minimum,
        actual: counts[key as keyof typeof counts],
        expected: minimum,
      }));
      return {
        enabled: true,
        fixtureVersion: DEMO_LOGISTICS_FIXTURE_VERSION,
        ready: checks.every((check) => check.ready) && row.recomputed_at !== null,
        counts,
        checks,
        recomputedAt: row.recomputed_at === null ? null : new Date(row.recomputed_at).toISOString(),
      };
    });
  }

  recompute() {
    return this.profiles.recompute('full');
  }
}
