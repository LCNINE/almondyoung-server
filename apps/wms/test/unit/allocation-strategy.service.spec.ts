import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AllocationStrategyService, AllocationRequest } from '../../src/inventory/services/allocation-strategy.service';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';

describe('AllocationStrategyService - Unit Tests', () => {
  let service: AllocationStrategyService;
  let module: TestingModule;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        AllocationStrategyService,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<AllocationStrategyService>(AllocationStrategyService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('FIFO Strategy', () => {
    it('should allocate from oldest stock first', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [loc1] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-OLD',
        locationType: 'standard',
      }).returning();

      const [loc2] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-NEW',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: loc1.id,
        qty: 50,
        stockState: 'ON_HAND',
        updatedAt: new Date('2024-01-01'),
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: loc2.id,
        qty: 100,
        stockState: 'ON_HAND',
        updatedAt: new Date('2024-01-15'),
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 80,
        strategy: 'FIFO',
        allowPartial: false,
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(80);
      expect(result.isPartial).toBe(false);
      expect(result.allocations).toHaveLength(2);
      
      expect(result.allocations[0].locationId).toBe(loc1.id);
      expect(result.allocations[0].quantity).toBe(50);
      
      expect(result.allocations[1].locationId).toBe(loc2.id);
      expect(result.allocations[1].quantity).toBe(30);
    });

    it('should fulfill request from single location when sufficient', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-SINGLE',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 500,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(100);
      expect(result.isPartial).toBe(false);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].locationId).toBe(location.id);
      expect(result.allocations[0].quantity).toBe(100);
    });

    it('should allocate from multiple locations (partial from each)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const locations: any[] = [];
      for (let i = 1; i <= 5; i++) {
        const [loc] = await db.insert(wmsTables.locations).values({
          warehouseId: warehouse.id,
          code: `LOC-${i}`,
          locationType: 'standard',
        }).returning();
        
        locations.push(loc);

        await db.insert(wmsTables.stockLedgers).values({
          skuId: sku.id,
          warehouseId: warehouse.id,
          locationId: loc.id,
          qty: 20,
          stockState: 'ON_HAND',
          updatedAt: new Date(`2024-01-${String(i).padStart(2, '0')}`),
        });
      }

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(100);
      expect(result.isPartial).toBe(false);
      expect(result.allocations).toHaveLength(5);
      
      result.allocations.forEach(alloc => {
        expect(alloc.quantity).toBe(20);
      });
    });

    it('should allocate exact match quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-EXACT',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 150,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 150,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(150);
      expect(result.isPartial).toBe(false);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].quantity).toBe(150);
    });
  });

  describe('LOCATION_PRIORITY Strategy', () => {
    it('should prioritize by location priority field', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [lowPriorityLoc] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-LOW',
        locationType: 'standard',
        fifoRank: 1,
      }).returning();

      const [highPriorityLoc] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-HIGH',
        locationType: 'standard',
        fifoRank: 10,
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: lowPriorityLoc.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: highPriorityLoc.id,
        qty: 50,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 80,
        strategy: 'LOCATION_PRIORITY',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(80);
      expect(result.allocations[0].locationId).toBe(highPriorityLoc.id);
      expect(result.allocations[0].quantity).toBe(50);
      
      expect(result.allocations[1].locationId).toBe(lowPriorityLoc.id);
      expect(result.allocations[1].quantity).toBe(30);
    });

    it('should handle mix of priorities (high, medium, low)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const priorities = [
        { code: 'LOC-HIGH', priority: 10, qty: 30 },
        { code: 'LOC-MED', priority: 5, qty: 40 },
        { code: 'LOC-LOW', priority: 1, qty: 50 },
      ];

      const locationMap = new Map();

      for (const p of priorities) {
        const [loc] = await db.insert(wmsTables.locations).values({
          warehouseId: warehouse.id,
          code: p.code,
          locationType: 'standard',
          fifoRank: p.priority,
        }).returning();

        locationMap.set(p.code, loc.id);

        await db.insert(wmsTables.stockLedgers).values({
          skuId: sku.id,
          warehouseId: warehouse.id,
          locationId: loc.id,
          qty: p.qty,
          stockState: 'ON_HAND',
        });
      }

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'LOCATION_PRIORITY',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(100);
      expect(result.allocations).toHaveLength(3);
      
      expect(result.allocations[0].locationId).toBe(locationMap.get('LOC-HIGH'));
      expect(result.allocations[0].quantity).toBe(30);
      
      expect(result.allocations[1].locationId).toBe(locationMap.get('LOC-MED'));
      expect(result.allocations[1].quantity).toBe(40);
      
      expect(result.allocations[2].locationId).toBe(locationMap.get('LOC-LOW'));
      expect(result.allocations[2].quantity).toBe(30);
    });
  });

  describe('Partial Allocation', () => {
    it('should return available quantity when allowPartial is true', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-PARTIAL',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 50,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
        allowPartial: true,
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(50);
      expect(result.isPartial).toBe(true);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].quantity).toBe(50);
    });

    it('should throw ConflictException when allowPartial is false and insufficient stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-INSUFFICIENT',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 30,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
        allowPartial: false,
      };

      await expect(
        service.allocateStock(request)
      ).rejects.toThrow(ConflictException);
    });

    it('should throw immediately when zero available stock', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 50,
        strategy: 'FIFO',
      };

      await expect(
        service.allocateStock(request)
      ).rejects.toThrow('No available stock');
    });
  });

  describe('Multi-Warehouse Allocation', () => {
    it('should allocate across multiple warehouses', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [loc1] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse1.id,
        code: 'WH1-LOC',
        locationType: 'standard',
      }).returning();

      const [loc2] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse2.id,
        code: 'WH2-LOC',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse1.id,
        locationId: loc1.id,
        qty: 40,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse2.id,
        locationId: loc2.id,
        qty: 60,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'MULTI_WAREHOUSE',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(100);
      expect(result.allocations).toHaveLength(2);
      
      const wh1Allocation = result.allocations.find(a => a.warehouseId === warehouse1.id);
      const wh2Allocation = result.allocations.find(a => a.warehouseId === warehouse2.id);

      expect(wh1Allocation).toBeDefined();
      expect(wh1Allocation!.quantity).toBe(40);
      
      expect(wh2Allocation).toBeDefined();
      expect(wh2Allocation!.quantity).toBe(60);
    });

    it('should prefer specific warehouse when warehouseId provided', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'Preferred' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'Other' });
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [loc1] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse1.id,
        code: 'PREF-LOC',
        locationType: 'standard',
      }).returning();

      const [loc2] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse2.id,
        code: 'OTHER-LOC',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse1.id,
        locationId: loc1.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse2.id,
        locationId: loc2.id,
        qty: 200,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 50,
        warehouseId: warehouse1.id,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(50);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].warehouseId).toBe(warehouse1.id);
    });

    it('should prioritize preferredLocationIds', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [preferredLoc] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'PREFERRED',
        locationType: 'standard',
      }).returning();

      const [regularLoc] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'REGULAR',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: preferredLoc.id,
        qty: 30,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: regularLoc.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 50,
        preferredLocationIds: [preferredLoc.id],
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBe(50);
      expect(result.allocations[0].locationId).toBe(preferredLoc.id);
      expect(result.allocations[0].quantity).toBe(30);
      
      expect(result.allocations[1].locationId).toBe(regularLoc.id);
      expect(result.allocations[1].quantity).toBe(20);
    });
  });

  describe('Edge Cases', () => {
    it('should reject request with zero quantity', async () => {
      const sku = await WmsTestFactory.createSku();

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 0,
        strategy: 'FIFO',
      };

      await expect(
        service.allocateStock(request)
      ).rejects.toThrow();
    });

    it('should reject request with negative quantity', async () => {
      const sku = await WmsTestFactory.createSku();

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: -50,
        strategy: 'FIFO',
      };

      await expect(
        service.allocateStock(request)
      ).rejects.toThrow();
    });

    it('should handle no available stock at all', async () => {
      const sku = await WmsTestFactory.createSku();

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 100,
        strategy: 'FIFO',
      };

      await expect(
        service.allocateStock(request)
      ).rejects.toThrow('No available stock');
    });

    it('should exclude reserved stock from allocation', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'LOC-RESERVED',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 70,
        stockState: 'DEFECTIVE',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 50,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.totalAllocated).toBeLessThanOrEqual(30);
    });
  });

  describe('Available Locations Query', () => {
    it('should return proper data structure (warehouseId, locationId, qty)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'TEST-LOC',
        locationType: 'zone',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        qty: 75,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 50,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.allocations[0]).toHaveProperty('warehouseId');
      expect(result.allocations[0]).toHaveProperty('locationId');
      expect(result.allocations[0]).toHaveProperty('quantity');
      expect(result.allocations[0]).toHaveProperty('locationCode');
      
      expect(result.allocations[0].warehouseId).toBe(warehouse.id);
      expect(result.allocations[0].locationId).toBe(location.id);
      expect(result.allocations[0].locationCode).toBe('TEST-LOC');
    });

    it('should filter by warehouse if specified', async () => {
      const warehouse1 = await WmsTestFactory.createWarehouse({ name: 'WH1' });
      const warehouse2 = await WmsTestFactory.createWarehouse({ name: 'WH2' });
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      
      const [loc1] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse1.id,
        code: 'WH1-LOC',
        locationType: 'standard',
      }).returning();

      const [loc2] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse2.id,
        code: 'WH2-LOC',
        locationType: 'standard',
      }).returning();

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse1.id,
        locationId: loc1.id,
        qty: 50,
        stockState: 'ON_HAND',
      });

      await db.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse2.id,
        locationId: loc2.id,
        qty: 100,
        stockState: 'ON_HAND',
      });

      const request: AllocationRequest = {
        skuId: sku.id,
        requestedQuantity: 40,
        warehouseId: warehouse1.id,
        strategy: 'FIFO',
      };

      const result = await service.allocateStock(request);

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].warehouseId).toBe(warehouse1.id);
      expect(result.allocations[0].locationId).toBe(loc1.id);
    });
  });
});

