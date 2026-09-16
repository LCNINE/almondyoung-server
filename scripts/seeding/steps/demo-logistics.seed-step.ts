import { DbService } from '@app/db';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { ReplenishmentSettingsReader } from '../../../apps/core/src/modules/inventory/replenishment/demand/replenishment-settings.reader';
import { DemandSeriesWriter } from '../../../apps/core/src/modules/inventory/replenishment/demand/demand-series.writer';
import { DemandProfileRefresher } from '../../../apps/core/src/modules/inventory/replenishment/demand/demand-profile.refresher';
import { LeadTimeProfileRefresher } from '../../../apps/core/src/modules/inventory/replenishment/demand/lead-time-profile.refresher';
import { ReplenishmentRefreshJob } from '../../../apps/core/src/modules/inventory/replenishment/demand/replenishment-refresh.job';
import { ReplenishmentProfileService } from '../../../apps/core/src/modules/inventory/replenishment/demand/replenishment-profile.service';
import { SeedStep } from './base-seed-step';
import type { SeedApplyResult, SeedCheckResult } from '../lib/types';
import { DEMO_LOGISTICS_FIXTURE as fixture, demoUuid } from './demo-logistics.fixture';

const HOLDER_ID = demoUuid(9, 900);

export function toDemoRuntimeDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete('uselibpqcompat');
  return url.toString();
}

export class DemoLogisticsSeedStep extends SeedStep {
  readonly groups = ['demo-logistics'] as const;

  constructor(databaseUrl: string) {
    super('Demo Logistics', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const checks = await Promise.all([
      this.findExistingIds(
        'product_variants',
        fixture.catalog.map((item) => item.variantId),
      ),
      this.findExistingIds(
        'skus',
        fixture.catalog.map((item) => item.skuId),
      ),
      this.findExistingIds(
        'suppliers',
        fixture.suppliers.map((item) => item.id),
      ),
      this.findExistingIds(
        'warehouses',
        fixture.warehouses.map((item) => item.id),
      ),
    ]);
    const [demand] = await this.client`
      SELECT count(*)::int AS count
      FROM sku_demand_daily
      WHERE sku_id = ANY(${fixture.catalog.map((item) => item.skuId)}) AND source = 'sellmate'
    `;
    const [leadTime] = await this.client`
      SELECT count(*)::int AS count
      FROM purchase_orders
      WHERE id = ANY(${Array.from({ length: 15 }, (_, index) => demoUuid(9, 201 + index))})
    `;
    const [demandProfiles] = await this.client`
      SELECT count(*)::int AS count
      FROM sku_demand_profiles
      WHERE sku_id = ANY(${fixture.catalog.map((item) => item.skuId)})
    `;
    const [supplierProfiles] = await this.client`
      SELECT count(*)::int AS count
      FROM supplier_lead_time_profiles
      WHERE supplier_id = ANY(${fixture.suppliers.map((item) => item.id)})
    `;
    const expected = [30, 30, 3, 2, 30 * fixture.demandDays, 15, 30, 3];
    const actual = [
      ...checks.map((rows) => rows.size),
      Number(demand.count),
      Number(leadTime.count),
      Number(demandProfiles.count),
      Number(supplierProfiles.count),
    ];
    const entities = [
      'product_variants',
      'skus',
      'suppliers',
      'warehouses',
      'sku_demand_daily',
      'lead_time_inputs',
      'sku_demand_profiles',
      'supplier_lead_time_profiles',
    ];
    const items = entities.map((entity, index) => ({
      entity,
      expected: expected[index],
      existing: Math.min(actual[index], expected[index]),
      missing: Math.max(0, expected[index] - actual[index]),
    }));
    return {
      service: this.serviceName,
      items,
      isFullySeeded: items.every((item) => item.missing === 0),
      summary: items.every((item) => item.missing === 0)
        ? `${fixture.version} is ready`
        : `${items.reduce((sum, item) => sum + item.missing, 0)} fixture rows missing`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const startedAt = Date.now();
    try {
      await this.client.begin(async (transaction) => {
        // postgres' TransactionSql runtime is callable like Sql, but its published CJS type drops the call signature.
        const trx = transaction as unknown as typeof this.client;
        await trx`
          INSERT INTO holders (id, name, is_our_asset)
          VALUES (${HOLDER_ID}, ${'아몬드영 데모 재고'}, true)
          ON CONFLICT (id) DO NOTHING
        `;

        for (const warehouse of fixture.warehouses) {
          await trx`
            INSERT INTO warehouses (id, name, type, is_sellable, supported_picking_strategies)
            VALUES (${warehouse.id}, ${warehouse.name}, ${warehouse.type}, ${warehouse.isSellable}, ARRAY['discrete']::picking_strategy[])
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, is_sellable = EXCLUDED.is_sellable,
              supported_picking_strategies = EXCLUDED.supported_picking_strategies
          `;
        }
        for (const location of fixture.locations) {
          await trx`
            INSERT INTO locations (
              id, warehouse_id, code, location_type, display_name, is_active, is_system, system_role
            ) VALUES (
              ${location.id}, ${location.warehouseId}, ${location.code}, 'zone', ${location.displayName}, true,
              ${location.isSystem}, ${location.systemRole}
            )
            ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, is_active = true
          `;
        }
        for (const supplier of fixture.suppliers) {
          await trx`
            INSERT INTO suppliers (id, name, code, default_warehouse_id, description)
            VALUES (${supplier.id}, ${supplier.name}, ${supplier.code}, ${fixture.warehouses[0].id}, ${fixture.version})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code
          `;
        }

        for (const item of fixture.catalog) {
          await trx`INSERT INTO product_masters (id) VALUES (${item.masterId}) ON CONFLICT (id) DO NOTHING`;
          await trx`
            INSERT INTO product_master_versions (
              id, master_id, version, status, approval_status, name, product_code, fulfillment_kind
            ) VALUES (
              ${item.versionId}, ${item.masterId}, 1, 'active', 'approved', ${item.productName}, ${item.sku}, 'physical'
            ) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'active'
          `;
          await trx`
            INSERT INTO product_variants (id, variant_name, status, is_default, variant_code)
            VALUES (${item.variantId}, ${item.productName}, 'active', true, ${item.sku})
            ON CONFLICT (id) DO UPDATE SET variant_name = EXCLUDED.variant_name, status = 'active'
          `;
          await trx`
            INSERT INTO product_master_variants (id, master_id, variant_id, version_id)
            VALUES (${demoUuid(9, 500 + Number(item.sku.slice(-3)))}, ${item.masterId}, ${item.variantId}, ${item.versionId})
            ON CONFLICT (master_id, variant_id, version_id) DO NOTHING
          `;
          await trx`
            INSERT INTO skus (
              id, holder_id, name, code, stock_type, safety_stock, korean_name, moq,
              primary_location_id, is_general_inventory
            ) VALUES (
              ${item.skuId}, ${HOLDER_ID}, ${item.productName}, ${item.sku}, 'physical', 5,
              ${item.productName}, 10, ${fixture.locations[2].id}, true
            ) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code
          `;
          await trx`
            INSERT INTO sku_barcodes (sku_id, barcode, is_primary)
            VALUES (${item.skuId}, ${`88090000${String(Number(item.sku.slice(-3))).padStart(4, '0')}`}, true)
            ON CONFLICT (barcode) DO NOTHING
          `;
          const supplier = fixture.suppliers[item.supplierIndex];
          await trx`
            INSERT INTO sku_suppliers (sku_id, supplier_id, supplier_sku)
            VALUES (${item.skuId}, ${supplier.id}, ${item.sku})
            ON CONFLICT (sku_id, supplier_id) DO NOTHING
          `;
          await trx`
            INSERT INTO product_matchings (
              id, variant_id, master_id, status, strategy, is_resolved, pre_stock_sellable
            ) VALUES (${item.matchingId}, ${item.variantId}, ${item.masterId}, 'matched', 'variant', true, false)
            ON CONFLICT (variant_id) DO UPDATE SET status = 'matched', strategy = 'variant', is_resolved = true
          `;
          await trx`
            INSERT INTO product_variant_sku_links (product_matching_id, sku_id, quantity)
            VALUES (${item.matchingId}, ${item.skuId}, 1)
            ON CONFLICT (product_matching_id, sku_id) DO UPDATE SET quantity = 1
          `;
          const journalId = demoUuid(9, Number(item.sku.slice(-3)));
          const eventId = demoUuid(9, 100 + Number(item.sku.slice(-3)));
          await trx`
            INSERT INTO stock_journals (id, source_type, source_id, idempotency_key)
            VALUES (${journalId}, 'demo_fixture', ${item.skuId}, ${`${fixture.version}:stock:${item.sku}`})
            ON CONFLICT (idempotency_key) DO NOTHING
          `;
          await trx`
            INSERT INTO stock_events (
              id, journal_id, sku_id, to_warehouse_id, to_location_id, to_state,
              transition_type, quantity, occurred_at, idempotency_key, reason
            ) VALUES (
              ${eventId}, ${journalId}, ${item.skuId}, ${fixture.warehouses[0].id}, ${fixture.locations[2].id},
              'ON_HAND', 'RECEIVE', ${item.availableQuantity}, now(), ${`${fixture.version}:receive:${item.sku}`},
              ${'demo-logistics baseline'}
            ) ON CONFLICT (idempotency_key) DO NOTHING
          `;
          await trx`
            INSERT INTO stock_ledgers (sku_id, warehouse_id, location_id, stock_state, qty, version)
            VALUES (${item.skuId}, ${fixture.warehouses[0].id}, ${fixture.locations[2].id}, 'ON_HAND', ${item.availableQuantity}, 1)
            ON CONFLICT (sku_id, warehouse_id, location_id, stock_state) DO NOTHING
          `;
        }

        await trx`
          DELETE FROM sku_demand_daily
          WHERE sku_id = ANY(${fixture.catalog.map((item) => item.skuId)}) AND source = 'sellmate'
        `;
        for (const [index, item] of fixture.catalog.entries()) {
          await trx`
            INSERT INTO sku_demand_daily (sku_id, demand_date, qty, amount, source)
            SELECT ${item.skuId}, d::date,
                   CASE
                     WHEN ${index % 3} = 0 THEN 2 + (extract(doy from d)::int % 3)
                     WHEN ${index % 3} = 1 THEN CASE WHEN extract(dow from d)::int IN (1, 4) THEN 5 ELSE 0 END
                     ELSE CASE WHEN extract(doy from d)::int % 11 = 0 THEN 12 ELSE 1 END
                   END,
                   CASE
                     WHEN ${index % 3} = 0 THEN (2 + (extract(doy from d)::int % 3)) * ${item.unitPrice}
                     WHEN ${index % 3} = 1 THEN (CASE WHEN extract(dow from d)::int IN (1, 4) THEN 5 ELSE 0 END) * ${item.unitPrice}
                     ELSE (CASE WHEN extract(doy from d)::int % 11 = 0 THEN 12 ELSE 1 END) * ${item.unitPrice}
                   END,
                   'sellmate'
            FROM generate_series(current_date - interval '365 days', current_date - interval '1 day', interval '1 day') d
          `;
        }

        let observation = 0;
        for (const supplier of fixture.suppliers) {
          for (const leadDays of supplier.leadTimeDays) {
            observation += 1;
            const poId = demoUuid(9, 200 + observation);
            const receiptId = demoUuid(9, 300 + observation);
            const receiptLineId = demoUuid(9, 400 + observation);
            const sku = fixture.catalog[(observation - 1) % fixture.catalog.length];
            await trx`
              INSERT INTO purchase_orders (
                id, type, supplier_id, status, source_warehouse_id, destination_warehouse_id,
                requires_transfer, audit_status, created_at
              ) VALUES (
                ${poId}, 'domestic', ${supplier.id}, 'received', ${fixture.warehouses[0].id},
                ${fixture.warehouses[0].id}, false, 'approved', now() - (${45 + observation} * interval '1 day')
              ) ON CONFLICT (id) DO NOTHING
            `;
            await trx`
              INSERT INTO purchase_order_lines (
                po_id, sku_id, quantity, unit_price, status, ordered_qty, ordered_at, received_qty
              ) VALUES (
                ${poId}, ${sku.skuId}, 10, ${sku.unitPrice}, 'ordered', 10,
                now() - (${45 + observation} * interval '1 day'), 10
              ) ON CONFLICT (po_id, sku_id) DO NOTHING
            `;
            await trx`
              INSERT INTO inbound_receipts (
                id, method, warehouse_id, location_id, occurred_at, status, total_quantity
              ) VALUES (
                ${receiptId}, 'planned', ${fixture.warehouses[0].id}, ${fixture.locations[0].id},
                now() - (${45 + observation - leadDays} * interval '1 day'), 'posted', 10
              ) ON CONFLICT (id) DO NOTHING
            `;
            await trx`
              INSERT INTO inbound_receipt_lines (
                id, receipt_id, sku_id, quantity, origin_location_id, source, memo
              ) VALUES (
                ${receiptLineId}, ${receiptId}, ${sku.skuId}, 10, ${fixture.locations[0].id},
                'purchase_order', ${fixture.version}
              ) ON CONFLICT (id) DO NOTHING
            `;
            await trx`
              INSERT INTO purchase_order_receipt_lines (po_id, sku_id, receipt_line_id)
              VALUES (${poId}, ${sku.skuId}, ${receiptLineId})
              ON CONFLICT (receipt_line_id) DO NOTHING
            `;
          }
        }
      });

      // Run the same three-stage full refresh used by POST /replenishment/profiles/recompute.
      // The fixture stores sellmate-partition demand inputs, so the core-series stage leaves them intact.
      const dbService = new DbService({ connectionString: toDemoRuntimeDatabaseUrl(this.databaseUrl) }, wmsSchema);
      try {
        const job = new ReplenishmentRefreshJob(
          new ReplenishmentSettingsReader(dbService),
          new DemandSeriesWriter(dbService),
          new DemandProfileRefresher(dbService),
          new LeadTimeProfileRefresher(dbService),
        );
        await new ReplenishmentProfileService(job).recompute('full');
      } finally {
        await dbService.onModuleDestroy();
      }

      return {
        service: this.serviceName,
        success: true,
        itemsApplied: 30 * fixture.demandDays + 30 + 15,
        duration: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        service: this.serviceName,
        success: false,
        itemsApplied: 0,
        duration: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
