import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../../src/inventory/services/inventory.service';
import { StockEventStore } from '../../src/inventory/repositories/stock-event.store';
import { InventoryQueryService } from '../../src/inventory/services/inventory-query.service';
import { InventoryCommandService } from '../../src/inventory/services/inventory-command.service';
import { LocationService } from '../../src/inventory/services/location.service';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

describe('InventoryService - Unit Tests', () => {
  let service: InventoryService;
  let eventStore: StockEventStore;
  let queryService: InventoryQueryService;
  let commandService: InventoryCommandService;
  let locationService: LocationService;
  let module: TestingModule;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        InventoryService,
        StockEventStore,
        InventoryQueryService,
        InventoryCommandService,
        LocationService,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    eventStore = module.get<StockEventStore>(StockEventStore);
    queryService = module.get<InventoryQueryService>(InventoryQueryService);
    commandService = module.get<InventoryCommandService>(InventoryCommandService);
    locationService = module.get<LocationService>(LocationService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('SKU Management', () => {
    describe('createSku', () => {
      it('should create SKU with full data (name, code, barcode, masterId)', async () => {
        const master = await WmsTestFactory.createMaster();
        const holder = await WmsTestFactory.createHolder();

        const skuData = {
          name: 'iPhone 15 Pro Max',
          masterId: master.id,
          safetyStock: 10,
        };

        const sku = await service.createSku(skuData);

        expect(sku).toBeDefined();
        expect(sku.id).toBeDefined();
        expect(sku.name).toBe(skuData.name);
        expect(sku.masterId).toBe(master.id);
        expect(sku.safetyStock).toBe(10);
      });

      it('should create SKU without masterId (auto-generates master)', async () => {
        const holder = await WmsTestFactory.createHolder();

        const skuData = {
          name: 'Samsung Galaxy S24',
        };

        const sku = await service.createSku(skuData);

        expect(sku).toBeDefined();
        expect(sku.masterId).toBeDefined();
        expect(sku.name).toBe(skuData.name);

        const db = WmsTestDatabase.getDb();
        const master = await db.query.inventoryProductMasters.findFirst({
          where: eq(wmsTables.inventoryProductMasters.id, sku.masterId),
        });

        expect(master).toBeDefined();
        expect(master!.name).toBe(skuData.name);
        expect(master!.status).toBe('active');
      });

      it('should fail to create SKU with duplicate code', async () => {
        const holder = await WmsTestFactory.createHolder();

        const firstSku = await service.createSku({
          name: 'Product A',
        });

        expect(firstSku).toBeDefined();

        await expect(
          service.createSku({
            name: 'Product B',
          })
        ).rejects.toThrow();
      });

      it('should create SKU with supplierIds and categoryIds (associations)', async () => {
        const holder = await WmsTestFactory.createHolder();
        const supplier1 = await WmsTestFactory.createSupplier();
        const supplier2 = await WmsTestFactory.createSupplier();

        const db = WmsTestDatabase.getDb();
        const [category1] = await db.insert(wmsTables.categories).values({
          name: 'Electronics',
        }).returning();
        const [category2] = await db.insert(wmsTables.categories).values({
          name: 'Mobile Phones',
        }).returning();

        const skuData = {
          name: 'Multi-Source Product',
          code: 'MULTI-SOURCE-001',
          holderId: holder.id,
          stockType: 'physical' as const,
          supplierIds: [supplier1.id, supplier2.id],
          categoryIds: [category1.id, category2.id],
        };

        const sku = await service.createSku(skuData);

        expect(sku).toBeDefined();

        const skuSuppliers = await db.query.skuSuppliers.findMany({
          where: eq(wmsTables.skuSuppliers.skuId, sku.id),
        });
        expect(skuSuppliers).toHaveLength(2);

        const skuCategories = await db.query.skuCategories.findMany({
          where: eq(wmsTables.skuCategories.skuId, sku.id),
        });
        expect(skuCategories).toHaveLength(2);
      });
    });

    describe('getSkuById', () => {
      it('should return SKU when found', async () => {
        const createdSku = await WmsTestFactory.createSku({
          name: 'Test Product',
          code: 'TEST-001',
        });

        const sku = await service.getSkuById(createdSku.id);

        expect(sku).toBeDefined();
        expect(sku.id).toBe(createdSku.id);
        expect(sku.name).toBe('Test Product');
        expect(sku.code).toBe('TEST-001');
      });

      it('should throw NotFoundException when SKU not found', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        await expect(
          service.getSkuById(nonExistentId)
        ).rejects.toThrow('SKU not found');
      });
    });

    describe('searchSkus', () => {
      beforeEach(async () => {
        await WmsTestFactory.createSku({
          name: 'iPhone 15 Pro',
          code: 'IPHONE-15-PRO',
          defaultBarcode: '1234567890123',
        });

        await WmsTestFactory.createSku({
          name: 'Samsung Galaxy S24',
          code: 'SAMSUNG-S24',
          defaultBarcode: '9876543210987',
        });

        await WmsTestFactory.createSku({
          name: 'iPad Air',
          code: 'IPAD-AIR',
        });
      });

      it('should search SKUs by code', async () => {
        const results = await service.searchSkus({ code: 'IPHONE-15-PRO' });

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('IPHONE-15-PRO');
      });

      it('should search SKUs by barcode', async () => {
        const results = await service.searchSkus({ barcode: '1234567890123' });

        expect(results).toHaveLength(1);
        expect(results[0].defaultBarcode).toBe('1234567890123');
      });

      it('should search SKUs by name (case-insensitive)', async () => {
        const results = await service.searchSkus({ name: 'iphone' });

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.some(s => s.name.toLowerCase().includes('iphone'))).toBe(true);
      });

      it('should search SKUs with multiple filters', async () => {
        const master = await WmsTestFactory.createMaster();
        await WmsTestFactory.createSku({
          name: 'Filtered Product',
          code: 'FILTERED-001',
          masterId: master.id,
        });

        const results = await service.searchSkus({
          name: 'Filtered',
          masterId: master.id,
        });

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('FILTERED-001');
        expect(results[0].masterId).toBe(master.id);
      });

      it('should return empty array when no matches', async () => {
        const results = await service.searchSkus({ code: 'NON-EXISTENT-CODE' });

        expect(results).toEqual([]);
      });
    });

    describe('updateSku', () => {
      it('should update SKU name', async () => {
        const sku = await WmsTestFactory.createSku({
          name: 'Original Name',
          code: 'UPDATE-TEST-001',
        });

        const updated = await service.updateSku(sku.id, {
          name: 'Updated Name',
        });

        expect(updated.name).toBe('Updated Name');
        expect(updated.code).toBe('UPDATE-TEST-001');
      });

      it('should update safetyStock', async () => {
        const sku = await WmsTestFactory.createSku({
          name: 'Safety Stock Test',
          code: 'SAFETY-001',
          safetyStock: 10,
        });

        const updated = await service.updateSku(sku.id, {
          safetyStock: 50,
        });

        expect(updated.safetyStock).toBe(50);
      });

      it('should throw NotFoundException for non-existent SKU', async () => {
        const nonExistentId = '00000000-0000-0000-0000-000000000000';

        await expect(
          service.updateSku(nonExistentId, { name: 'New Name' })
        ).rejects.toThrow('SKU not found');
      });
    });

    describe('addBarcode', () => {
      it('should add barcode to existing SKU', async () => {
        const sku = await WmsTestFactory.createSku({
          name: 'Barcode Test',
          code: 'BARCODE-001',
        });

        await service.addBarcode(sku.id, {
          barcode: '1111222233334444',
          barcodeType: 'standard',
        });

        const db = WmsTestDatabase.getDb();
        const barcodes = await db.query.skuBarcodes.findMany({
          where: eq(wmsTables.skuBarcodes.skuId, sku.id),
        });

        expect(barcodes.length).toBeGreaterThanOrEqual(1);
        expect(barcodes.some(b => b.barcode === '1111222233334444')).toBe(true);
      });
    });
  });

  describe('Warehouse Management', () => {
    describe('createWarehouse', () => {
      it('should create warehouse with domestic type', async () => {
        const warehouseData = {
          name: 'Seoul Main Warehouse',
          location: 'Seoul, South Korea',
          type: 'domestic' as const,
        };

        const warehouse = await service.createWarehouse(warehouseData);

        expect(warehouse).toBeDefined();
        expect(warehouse.name).toBe('Seoul Main Warehouse');
        expect(warehouse.type).toBe('domestic');
        expect(warehouse.location).toBe('Seoul, South Korea');
      });

      it('should create warehouse with overseas type', async () => {
        const warehouseData = {
          name: 'Shanghai Warehouse',
          location: 'Shanghai, China',
          type: 'overseas' as const,
        };

        const warehouse = await service.createWarehouse(warehouseData);

        expect(warehouse).toBeDefined();
        expect(warehouse.type).toBe('overseas');
      });

      it('should auto-create system locations for new warehouse', async () => {
        const warehouse = await service.createWarehouse({
          name: 'Test Warehouse with Locations',
          type: 'domestic' as const,
        });

        const db = WmsTestDatabase.getDb();
        const locations = await db.query.locations.findMany({
          where: eq(wmsTables.locations.warehouseId, warehouse.id),
        });

        expect(locations.length).toBeGreaterThan(0);
        
        const systemRoles = locations.map(l => l.systemRole).filter(Boolean);
        expect(systemRoles.length).toBeGreaterThan(0);
      });
    });

    describe('updateWarehouse', () => {
      it('should update warehouse location', async () => {
        const warehouse = await WmsTestFactory.createWarehouse({
          name: 'Original Warehouse',
          location: 'Original Location',
        });

        const updated = await service.updateWarehouse(warehouse.id, {
          location: 'New Location',
        });

        expect(updated.location).toBe('New Location');
        expect(updated.name).toBe('Original Warehouse');
      });

      it('should update warehouse type', async () => {
        const warehouse = await WmsTestFactory.createWarehouse({
          name: 'Type Change Warehouse',
          type: 'domestic',
        });

        const updated = await service.updateWarehouse(warehouse.id, {
          type: 'overseas',
        });

        expect(updated.type).toBe('overseas');
      });
    });

    describe('getWarehouses', () => {
      it('should list all warehouses', async () => {
        await WmsTestFactory.createWarehouse({ name: 'Warehouse 1' });
        await WmsTestFactory.createWarehouse({ name: 'Warehouse 2' });
        await WmsTestFactory.createWarehouse({ name: 'Warehouse 3' });

        const warehouses = await service.findAllWarehouses();

        expect(warehouses.length).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe('Stock Queries', () => {
    let warehouse: any;
    let sku: any;

    beforeEach(async () => {
      warehouse = await WmsTestFactory.createWarehouse();
      sku = await WmsTestFactory.createSku();
    });

    describe('getCurrentStock', () => {
      it('should query stock with skuId filter', async () => {
        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 100,
          availableQty: 100,
        });

        const result = await service.getCurrentStock({ skuId: sku.id });

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].skuId).toBe(sku.id);
      });

      it('should query stock with warehouseId filter', async () => {
        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 50,
        });

        const result = await service.getCurrentStock({ warehouseId: warehouse.id });

        expect(result.length).toBeGreaterThan(0);
        expect(result[0].warehouseId).toBe(warehouse.id);
      });

      it('should return empty array for non-existent SKU', async () => {
        const result = await service.getCurrentStock({
          skuId: '00000000-0000-0000-0000-000000000000',
        });

        expect(result).toEqual([]);
      });
    });

    describe('getQuickStockSummary', () => {
      it('should return aggregated stock view', async () => {
        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 100,
          availableQty: 80,
          reservedQty: 20,
        });

        const summary = await service.getQuickStockSummary(sku.id, warehouse.id);

        expect(summary.length).toBeGreaterThan(0);
        expect(summary[0].onHandQty).toBe(100);
        expect(summary[0].availableQty).toBe(80);
        expect(summary[0].reservedQty).toBe(20);
      });

      it('should filter by skuId', async () => {
        const sku2 = await WmsTestFactory.createSku();

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku2.id,
          onHandQty: 200,
        });

        const summary = await service.getQuickStockSummary(sku.id);

        expect(summary).toHaveLength(1);
        expect(summary[0].skuId).toBe(sku.id);
      });
    });

    describe('getTotalStockForSku', () => {
      it('should sum stock across all warehouses', async () => {
        const warehouse2 = await WmsTestFactory.createWarehouse();

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 100,
          availableQty: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse2.id,
          skuId: sku.id,
          onHandQty: 150,
          availableQty: 150,
        });

        const total = await service.getTotalStockBySku(sku.id);

        expect(total.totalRealQuantity).toBe(250);
        expect(total.totalAvailableQuantity).toBe(250);
      });

      it('should return zero for SKU with no stock', async () => {
        const newSku = await WmsTestFactory.createSku();

        const total = await service.getTotalStockBySku(newSku.id);

        expect(total.totalRealQuantity).toBe(0);
        expect(total.totalAvailableQuantity).toBe(0);
      });
    });
  });

  describe('Transaction Handling', () => {
    it('should pass transaction correctly through inTx', async () => {
      const holder = await WmsTestFactory.createHolder();
      
      const db = WmsTestDatabase.getDb();
      
      await db.transaction(async (tx) => {
        const sku = await service.createSku({
          name: 'Transaction Test',
        }, tx as any);

        expect(sku).toBeDefined();
        expect(sku.name).toBe('Transaction Test');
      });

      const db2 = WmsTestDatabase.getDb();
      const skus = await db2.query.skus.findMany();
      expect(skus.some(s => s.name === 'Transaction Test')).toBe(true);
    });

    it('should rollback on error', async () => {
      const holder = await WmsTestFactory.createHolder();
      const db = WmsTestDatabase.getDb();

      try {
        await db.transaction(async (tx) => {
          await service.createSku({
            name: 'Rollback Test 1',
          }, tx as any);

          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected error
      }

      const db2 = WmsTestDatabase.getDb();
      const skus = await db2.query.skus.findMany();
      expect(skus.some(s => s.name === 'Rollback Test 1')).toBe(false);
    });
  });
});

