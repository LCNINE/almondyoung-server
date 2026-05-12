import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';


const WAREHOUSES = [
  { id: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, name: '부천 물류창고', type: 'domestic' },
  { id: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, name: '중국 물류창고', type: 'overseas' },
];

const LOCATIONS = [
  { id: FIXED_UUIDS.LOC_BUCHEON_RECEIVING, warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, code: 'RECEIVING_DEFAULT', displayName: '입고기본존', isSystem: true, systemRole: 'inbound_default' },
  { id: FIXED_UUIDS.LOC_BUCHEON_SHIPPING, warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, code: 'SHIPPING_DEFAULT', displayName: '출고기본존', isSystem: false, systemRole: null },
  { id: FIXED_UUIDS.LOC_BUCHEON_DAMAGE, warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, code: 'DAMAGE_DEFAULT', displayName: '불량기본존', isSystem: false, systemRole: null },
  { id: FIXED_UUIDS.LOC_BUCHEON_RETURN, warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, code: 'RETURN_DEFAULT', displayName: '반품기본존', isSystem: true, systemRole: 'return_default' },
  { id: FIXED_UUIDS.LOC_CHINA_RECEIVING, warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, code: 'RECEIVING_DEFAULT', displayName: '입고기본존', isSystem: true, systemRole: 'inbound_default' },
  { id: FIXED_UUIDS.LOC_CHINA_SHIPPING, warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, code: 'SHIPPING_DEFAULT', displayName: '출고기본존', isSystem: false, systemRole: null },
  { id: FIXED_UUIDS.LOC_CHINA_DAMAGE, warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, code: 'DAMAGE_DEFAULT', displayName: '불량기본존', isSystem: false, systemRole: null },
  { id: FIXED_UUIDS.LOC_CHINA_RETURN, warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, code: 'RETURN_DEFAULT', displayName: '반품기본존', isSystem: true, systemRole: 'return_default' },
];

const SETTINGS = [
  { warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, key: 'use_sub_barcode', value: 'true' },
  { warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC, key: 'use_expiry_separation', value: 'false' },
  { warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, key: 'use_sub_barcode', value: 'true' },
  { warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS, key: 'use_expiry_separation', value: 'false' },
];

export class WmsSeedStep extends SeedStep {
  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string) {
    super('WMS', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const warehouseIds = WAREHOUSES.map((w) => w.id);
    const existingWarehouses = await this.findExistingIds('warehouses', warehouseIds);
    const missingWarehouses = warehouseIds.filter((id) => !existingWarehouses.has(id));

    const locationIds = LOCATIONS.map((l) => l.id);
    const existingLocations = await this.findExistingIds('locations', locationIds);
    const missingLocations = locationIds.filter((id) => !existingLocations.has(id));

    // Settings: check by warehouse_id + key composite
    const compositeValues = SETTINGS.map((s) => `('${s.warehouseId}', '${s.key}')`).join(', ');
    const existingSettingsRows = await this.client.unsafe(
      `SELECT warehouse_id || '::' || key as composite
       FROM settings
       WHERE (warehouse_id, key) IN (${compositeValues})`,
    );
    const existingSettings = new Set(existingSettingsRows.map((r) => r.composite));
    const missingSettings = SETTINGS.filter(
      (s) => !existingSettings.has(`${s.warehouseId}::${s.key}`),
    );

    const items = [
      {
        entity: 'warehouses',
        expected: WAREHOUSES.length,
        existing: existingWarehouses.size,
        missing: missingWarehouses.length,
        missingDetails: missingWarehouses.map(
          (id) => WAREHOUSES.find((w) => w.id === id)!.name,
        ),
      },
      {
        entity: 'locations',
        expected: LOCATIONS.length,
        existing: existingLocations.size,
        missing: missingLocations.length,
        missingDetails: missingLocations.map(
          (id) => LOCATIONS.find((l) => l.id === id)!.displayName,
        ),
      },
      {
        entity: 'settings',
        expected: SETTINGS.length,
        existing: SETTINGS.length - missingSettings.length,
        missing: missingSettings.length,
        missingDetails: missingSettings.map((s) => `${s.key}`),
      },
    ];

    const isFullySeeded = items.every((i) => i.missing === 0);
    const totalMissing = items.reduce((sum, i) => sum + i.missing, 0);
    const summary = isFullySeeded
      ? 'All WMS seed data present'
      : `${totalMissing} missing record(s)`;

    return { service: 'WMS', items, isFullySeeded, summary };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      // Warehouses
      this.logger.step(1, 3, 'Inserting warehouses');
      for (const w of WAREHOUSES) {
        await this.db.execute(sql`
          INSERT INTO warehouses (id, name, type)
          VALUES (${w.id}, ${w.name}, ${w.type})
          ON CONFLICT (id) DO NOTHING
        `);
      }
      itemsApplied += WAREHOUSES.length;

      // Locations
      this.logger.step(2, 3, 'Inserting system locations');
      for (const loc of LOCATIONS) {
        await this.db.execute(sql`
          INSERT INTO locations (
            id, warehouse_id, code, location_type, rack_id, bin_identifier,
            display_name, is_expiry_separated, is_active, is_system, system_role
          )
          VALUES (
            ${loc.id}, ${loc.warehouseId}, ${loc.code}, ${'zone'},
            ${null}, ${null},
            ${loc.displayName}, ${false}, ${true},
            ${loc.isSystem}, ${loc.systemRole}
          )
          ON CONFLICT (warehouse_id, code) DO NOTHING
        `);
      }
      itemsApplied += LOCATIONS.length;

      // Settings
      this.logger.step(3, 3, 'Inserting warehouse settings');
      for (const s of SETTINGS) {
        await this.db.execute(sql`
          INSERT INTO settings (warehouse_id, key, value)
          VALUES (${s.warehouseId}, ${s.key}, ${s.value})
          ON CONFLICT DO NOTHING
        `);
      }
      itemsApplied += SETTINGS.length;

      this.logger.success('WMS seeding completed');
      return { service: 'WMS', success: true, itemsApplied, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('WMS seeding failed', error);
      return { service: 'WMS', success: false, itemsApplied, duration: Date.now() - start, error: error.message };
    }
  }
}
