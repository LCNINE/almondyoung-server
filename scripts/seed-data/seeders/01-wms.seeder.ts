import { drizzle } from 'drizzle-orm/postgres-js';
import { InferInsertModel, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as wmsSchema from '../../../apps/wms/database/schemas/wms-schema';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('WMS Seeder');

type WarehouseInsert = InferInsertModel<typeof wmsSchema.warehouses>;
type LocationInsert = InferInsertModel<typeof wmsSchema.locations>;
type SettingInsert = InferInsertModel<typeof wmsSchema.settings>;

export async function seedWMS(databaseUrl: string): Promise<void> {
  logger.info('Starting WMS seeding');

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Step 1: Insert Warehouses
    logger.step(1, 3, 'Inserting warehouses');

    const warehouses: WarehouseInsert[] = [
      {
        id: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        name: '부천 물류창고',
        type: 'domestic',
      },
      {
        id: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        name: '중국 물류창고',
        type: 'overseas',
      },
    ];

    await db.execute(sql`
      INSERT INTO warehouses (id, name, type)
      VALUES
        (${warehouses[0].id}, ${warehouses[0].name}, ${warehouses[0].type}),
        (${warehouses[1].id}, ${warehouses[1].name}, ${warehouses[1].type})
      ON CONFLICT (id) DO NOTHING
    `);

    logger.success(`Inserted ${warehouses.length} warehouses`);

    // Step 2: Insert System Locations
    logger.step(2, 3, 'Inserting system locations');

    const locations: LocationInsert[] = [
      // Bucheon warehouse locations
      {
        id: FIXED_UUIDS.LOC_BUCHEON_RECEIVING,
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        code: 'RECEIVING_DEFAULT',
        locationType: 'zone',
        displayName: '입고기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: true,
        systemRole: 'inbound_default',
      },
      {
        id: FIXED_UUIDS.LOC_BUCHEON_SHIPPING,
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        code: 'SHIPPING_DEFAULT',
        locationType: 'zone',
        displayName: '출고기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: false,
      },
      {
        id: FIXED_UUIDS.LOC_BUCHEON_DAMAGE,
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        code: 'DAMAGE_DEFAULT',
        locationType: 'zone',
        displayName: '불량기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: false,
      },
      {
        id: FIXED_UUIDS.LOC_BUCHEON_RETURN,
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        code: 'RETURN_DEFAULT',
        locationType: 'zone',
        displayName: '반품기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: true,
        systemRole: 'return_default',
      },
      // China warehouse locations
      {
        id: FIXED_UUIDS.LOC_CHINA_RECEIVING,
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        code: 'RECEIVING_DEFAULT',
        locationType: 'zone',
        displayName: '입고기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: true,
        systemRole: 'inbound_default',
      },
      {
        id: FIXED_UUIDS.LOC_CHINA_SHIPPING,
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        code: 'SHIPPING_DEFAULT',
        locationType: 'zone',
        displayName: '출고기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: false,
      },
      {
        id: FIXED_UUIDS.LOC_CHINA_DAMAGE,
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        code: 'DAMAGE_DEFAULT',
        locationType: 'zone',
        displayName: '불량기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: false,
      },
      {
        id: FIXED_UUIDS.LOC_CHINA_RETURN,
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        code: 'RETURN_DEFAULT',
        locationType: 'zone',
        displayName: '반품기본존',
        isExpirySeparated: false,
        isActive: true,
        isSystem: true,
        systemRole: 'return_default',
      },
    ];

    for (const loc of locations) {
      await db.execute(sql`
        INSERT INTO locations (
          id, warehouse_id, code, location_type, rack_id, bin_identifier,
          display_name, is_expiry_separated, is_active, is_system, system_role
        )
        VALUES (
          ${loc.id}, ${loc.warehouseId}, ${loc.code}, ${loc.locationType},
          ${loc.rackId ?? null}, ${loc.binIdentifier ?? null},
          ${loc.displayName}, ${loc.isExpirySeparated}, ${loc.isActive},
          ${loc.isSystem}, ${loc.systemRole ?? null}
        )
        ON CONFLICT (warehouse_id, code) DO NOTHING
      `);
    }

    logger.success(`Inserted ${locations.length} system locations`);

    // Step 3: Insert Settings
    logger.step(3, 3, 'Inserting warehouse settings');

    const settings: SettingInsert[] = [
      // Bucheon settings
      {
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        key: 'use_sub_barcode',
        value: 'true',
      },
      {
        warehouseId: FIXED_UUIDS.WAREHOUSE_BUCHEON_DOMESTIC,
        key: 'use_expiry_separation',
        value: 'false',
      },
      // China settings
      {
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        key: 'use_sub_barcode',
        value: 'true',
      },
      {
        warehouseId: FIXED_UUIDS.WAREHOUSE_CHINA_OVERSEAS,
        key: 'use_expiry_separation',
        value: 'false',
      },
    ];

    for (const setting of settings) {
      await db.execute(sql`
        INSERT INTO settings (warehouse_id, key, value)
        VALUES (${setting.warehouseId}, ${setting.key}, ${setting.value})
        ON CONFLICT DO NOTHING
      `);
    }

    logger.success(`Inserted ${settings.length} settings`);
    logger.success('WMS seeding completed successfully');
  } catch (error) {
    logger.error('WMS seeding failed', error);
    throw error;
  } finally {
    await client.end();
  }
}
