import { Test, TestingModule } from '@nestjs/testing';
import { SafetyStockService } from '../../src/inventory/services/safety-stock.service';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';

describe('SafetyStockService - Unit Tests', () => {
  let service: SafetyStockService;
  let module: TestingModule;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        SafetyStockService,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<SafetyStockService>(SafetyStockService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('Safety Stock Warnings', () => {
    describe('getBelowSafetyStock', () => {
      it('should return SKUs below safety stock in single warehouse', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();
        
        const sku1 = await WmsTestFactory.createSku({
          name: 'Low Stock Item',
          code: 'LOW-STOCK-001',
          safetyStock: 50,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku1.id,
          onHandQty: 30,
          availableQty: 30,
        });

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        expect(warnings).toHaveLength(1);
        expect(warnings[0].skuId).toBe(sku1.id);
        expect(warnings[0].currentStock).toBe(30);
        expect(warnings[0].safetyStock).toBe(50);
        expect(warnings[0].shortfall).toBe(20);
        expect(warnings[0].warehouseId).toBe(warehouse.id);
      });

      it('should return SKUs below safety stock across all warehouses', async () => {
        const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'Warehouse 1' });
        const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'Warehouse 2' });

        const sku1 = await WmsTestFactory.createSku({
          name: 'Multi-Warehouse Low Stock',
          code: 'MULTI-LOW-001',
          safetyStock: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse1.id,
          skuId: sku1.id,
          onHandQty: 40,
          availableQty: 40,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse2.id,
          skuId: sku1.id,
          onHandQty: 30,
          availableQty: 30,
        });

        const warnings = await service.getBelowSafetyStock();

        expect(warnings.length).toBeGreaterThanOrEqual(2);
        
        const warehouse1Warning = warnings.find(w => w.warehouseId === warehouse1.id);
        const warehouse2Warning = warnings.find(w => w.warehouseId === warehouse2.id);

        expect(warehouse1Warning).toBeDefined();
        expect(warehouse1Warning!.shortfall).toBe(60);
        
        expect(warehouse2Warning).toBeDefined();
        expect(warehouse2Warning!.shortfall).toBe(70);
      });

      it('should handle multiple SKUs below threshold', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();

        const sku1 = await WmsTestFactory.createSku({
          name: 'Product A',
          code: 'PROD-A',
          safetyStock: 50,
        });

        const sku2 = await WmsTestFactory.createSku({
          name: 'Product B',
          code: 'PROD-B',
          safetyStock: 100,
        });

        const sku3 = await WmsTestFactory.createSku({
          name: 'Product C',
          code: 'PROD-C',
          safetyStock: 20,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku1.id,
          onHandQty: 20,
          availableQty: 20,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku2.id,
          onHandQty: 30,
          availableQty: 30,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku3.id,
          onHandQty: 5,
          availableQty: 5,
        });

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        expect(warnings).toHaveLength(3);
        
        const productAWarning = warnings.find(w => w.skuCode === 'PROD-A');
        expect(productAWarning!.shortfall).toBe(30);

        const productBWarning = warnings.find(w => w.skuCode === 'PROD-B');
        expect(productBWarning!.shortfall).toBe(70);

        const productCWarning = warnings.find(w => w.skuCode === 'PROD-C');
        expect(productCWarning!.shortfall).toBe(15);
      });

      it('should detect SKU with zero stock but has safety stock', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();

        const sku = await WmsTestFactory.createSku({
          name: 'Out of Stock Item',
          code: 'OUT-STOCK-001',
          safetyStock: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku.id,
          onHandQty: 0,
          availableQty: 0,
        });

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        expect(warnings).toHaveLength(1);
        expect(warnings[0].currentStock).toBe(0);
        expect(warnings[0].safetyStock).toBe(100);
        expect(warnings[0].shortfall).toBe(100);
      });

      it('should handle SKU without safety stock set (null)', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();

        const skuWithoutSafety = await WmsTestFactory.createSku({
          name: 'No Safety Stock',
          code: 'NO-SAFETY-001',
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: skuWithoutSafety.id,
          onHandQty: 10,
          availableQty: 10,
        });

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        const noSafetyWarning = warnings.find(w => w.skuCode === 'NO-SAFETY-001');
        expect(noSafetyWarning).toBeUndefined();
      });

      it('should calculate shortfall correctly', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();

        const testCases = [
          { safetyStock: 100, currentStock: 80, expectedShortfall: 20 },
          { safetyStock: 50, currentStock: 10, expectedShortfall: 40 },
          { safetyStock: 200, currentStock: 0, expectedShortfall: 200 },
          { safetyStock: 30, currentStock: 25, expectedShortfall: 5 },
        ];

        for (const testCase of testCases) {
          const sku = await WmsTestFactory.createSku({
            name: `Test ${testCase.safetyStock}`,
            code: `TEST-${testCase.safetyStock}`,
            safetyStock: testCase.safetyStock,
          });

          await WmsTestFactory.createStock({
            warehouseId: warehouse.id,
            skuId: sku.id,
            onHandQty: testCase.currentStock,
            availableQty: testCase.currentStock,
          });
        }

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        expect(warnings.length).toBe(testCases.length);

        testCases.forEach(testCase => {
          const warning = warnings.find(w => w.safetyStock === testCase.safetyStock);
          expect(warning).toBeDefined();
          expect(warning!.shortfall).toBe(testCase.expectedShortfall);
        });
      });

      it('should return empty array when all stock is sufficient', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();

        const sku1 = await WmsTestFactory.createSku({
          name: 'Well Stocked Item 1',
          code: 'WELL-STOCK-001',
          safetyStock: 50,
        });

        const sku2 = await WmsTestFactory.createSku({
          name: 'Well Stocked Item 2',
          code: 'WELL-STOCK-002',
          safetyStock: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku1.id,
          onHandQty: 100,
          availableQty: 100,
        });

        await WmsTestFactory.createStock({
          warehouseId: warehouse.id,
          skuId: sku2.id,
          onHandQty: 150,
          availableQty: 150,
        });

        const warnings = await service.getBelowSafetyStock(warehouse.id);

        expect(warnings).toHaveLength(0);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large safety stock values', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const sku = await WmsTestFactory.createSku({
        name: 'Large Safety Stock',
        code: 'LARGE-SAFETY-001',
        safetyStock: 1000000,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 500000,
        availableQty: 500000,
      });

      const warnings = await service.getBelowSafetyStock(warehouse.id);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].safetyStock).toBe(1000000);
      expect(warnings[0].currentStock).toBe(500000);
      expect(warnings[0].shortfall).toBe(500000);
    });

    it('should handle multiple warehouses with same SKU', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'W1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'W2' });
      const warehouse3 = await WmsTestFactory.createWarehouse({ name: 'W3' });

      const sku = await WmsTestFactory.createSku({
        name: 'Multi-Warehouse SKU',
        code: 'MULTI-WH-001',
        safetyStock: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse1.id,
        skuId: sku.id,
        onHandQty: 150,
        availableQty: 150,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse2.id,
        skuId: sku.id,
        onHandQty: 50,
        availableQty: 50,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse3.id,
        skuId: sku.id,
        onHandQty: 30,
        availableQty: 30,
      });

      const allWarnings = await service.getBelowSafetyStock();
      const thisSkuWarnings = allWarnings.filter(w => w.skuCode === 'MULTI-WH-001');

      expect(thisSkuWarnings).toHaveLength(2);
      
      const wh2Warning = thisSkuWarnings.find(w => w.warehouseId === warehouse2.id);
      expect(wh2Warning).toBeDefined();
      expect(wh2Warning!.currentStock).toBe(50);

      const wh3Warning = thisSkuWarnings.find(w => w.warehouseId === warehouse3.id);
      expect(wh3Warning).toBeDefined();
      expect(wh3Warning!.currentStock).toBe(30);

      const wh1Warning = thisSkuWarnings.find(w => w.warehouseId === warehouse1.id);
      expect(wh1Warning).toBeUndefined();
    });

    it('should handle SKU with stock exactly at safety level', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const sku = await WmsTestFactory.createSku({
        name: 'Exact Safety Stock',
        code: 'EXACT-SAFETY-001',
        safetyStock: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
      });

      const warnings = await service.getBelowSafetyStock(warehouse.id);

      const exactWarning = warnings.find(w => w.skuCode === 'EXACT-SAFETY-001');
      expect(exactWarning).toBeUndefined();
    });

    it('should handle SKU one unit below safety threshold', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();

      const sku = await WmsTestFactory.createSku({
        name: 'One Below Safety',
        code: 'ONE-BELOW-001',
        safetyStock: 100,
      });

      await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 99,
        availableQty: 99,
      });

      const warnings = await service.getBelowSafetyStock(warehouse.id);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].shortfall).toBe(1);
    });
  });
});

