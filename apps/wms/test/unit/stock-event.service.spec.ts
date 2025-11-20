import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { StockEventService } from '../../src/inventory/services/stock-event.service';
import { InventoryService } from '../../src/inventory/services/inventory.service';
import { StockEventStore } from '../../src/inventory/repositories/stock-event.store';
import { InventoryCommandService } from '../../src/inventory/services/inventory-command.service';
import { UnifiedReservationService } from '../../src/shared/services/unified-reservation.service';
import { AllocationStrategyService } from '../../src/inventory/services/allocation-strategy.service';
import { InventoryQueryService } from '../../src/inventory/services/inventory-query.service';
import { LocationService } from '../../src/inventory/services/location.service';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables, wmsViews } from '../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

describe('StockEventService - Unit Tests', () => {
  let service: StockEventService;
  let inventoryService: InventoryService;
  let eventStore: StockEventStore;
  let commandService: InventoryCommandService;
  let module: TestingModule;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        StockEventService,
        InventoryService,
        StockEventStore,
        InventoryCommandService,
        InventoryQueryService,
        LocationService,
        UnifiedReservationService,
        AllocationStrategyService,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<StockEventService>(StockEventService);
    inventoryService = module.get<InventoryService>(InventoryService);
    eventStore = module.get<StockEventStore>(StockEventStore);
    commandService = module.get<InventoryCommandService>(InventoryCommandService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('Stock Entry Creation', () => {
    describe('createStockEntryBySkuId', () => {
      it('should create stock entry with valid SKU', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();
        const sku = await WmsTestFactory.createSku();

        const db = WmsTestDatabase.getDb();
        const [location] = await db.insert(wmsTables.locations).values({
          warehouseId: warehouse.id,
          code: 'ENTRY-LOC',
          locationType: 'zone',
        }).returning();

        const result = await service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-001',
          warehouseId: warehouse.id,
          locationId: location.id,
          quantity: 100,
          stockType: 'physical',
          reason: 'Initial stock entry',
        });

        expect(result).toBeDefined();
        expect(result.skuId).toBeDefined();
      });

      it('should fail with non-existent SKU', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();
        const nonExistentSkuId = '00000000-0000-0000-0000-000000000000';

        await expect(
          service.createStockEntryBySkuId({
            skuId: nonExistentSkuId,
            variantId: 'variant-001',
            warehouseId: warehouse.id,
            quantity: 50,
            stockType: 'physical',
          })
        ).rejects.toThrow();
      });

      it('should create event via eventStore', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();
        const sku = await WmsTestFactory.createSku();

        await service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-002',
          warehouseId: warehouse.id,
          quantity: 75,
          stockType: 'physical',
        });

        const db = WmsTestDatabase.getDb();
        const events = await db.query.stockEvents.findMany({
          where: eq(wmsTables.stockEvents.skuId, sku.id),
        });

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].transitionType).toBe('RECEIVE');
      });

      it('should update stock summary projection', async () => {
        const warehouse = await WmsTestFactory.createWarehouse();
        const sku = await WmsTestFactory.createSku();

        await service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-003',
          warehouseId: warehouse.id,
          quantity: 200,
          stockType: 'physical',
        });

        const db = WmsTestDatabase.getDb();
        const [summary] = await db.select().from(wmsViews.stockSummary)
          .where(eq(wmsViews.stockSummary.skuId, sku.id))
          .limit(1);

        expect(summary).toBeDefined();
        expect(summary!.onHandQty).toBeGreaterThanOrEqual(200);
      });
    });
  });

  describe('SKU Validation', () => {
    it('should validate that SKU exists (no auto-creation)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const fakeSkuId = '11111111-1111-1111-1111-111111111111';

      await expect(
        service.createStockEntryBySkuId({
          skuId: fakeSkuId,
          variantId: 'variant-004',
          warehouseId: warehouse.id,
          quantity: 50,
          stockType: 'physical',
        })
      ).rejects.toThrow();
    });

    it('should validate that warehouse exists', async () => {
      const sku = await WmsTestFactory.createSku();
      const fakeWarehouseId = '22222222-2222-2222-2222-222222222222';

      await expect(
        service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-005',
          warehouseId: fakeWarehouseId,
          quantity: 50,
          stockType: 'physical',
        })
      ).rejects.toThrow();
    });

    it('should validate location if provided', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();
      const fakeLocationId = '33333333-3333-3333-3333-333333333333';

      await expect(
        service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-006',
          warehouseId: warehouse.id,
          locationId: fakeLocationId,
          quantity: 50,
          stockType: 'physical',
        })
      ).rejects.toThrow();
    });
  });

  describe('Quantity Validation', () => {
    it('should accept positive quantity only', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-007',
        warehouseId: warehouse.id,
        quantity: 1,
        stockType: 'physical',
      });

      expect(result.skuId).toBeDefined();
    });

    it('should reject zero quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await expect(
        service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-008',
          warehouseId: warehouse.id,
          quantity: 0,
          stockType: 'physical',
        })
      ).rejects.toThrow();
    });

    it('should reject negative quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await expect(
        service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-009',
          warehouseId: warehouse.id,
          quantity: -100,
          stockType: 'physical',
        })
      ).rejects.toThrow();
    });
  });

  describe('Integration with Other Services', () => {
    it('should call InventoryCommandService.receive', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-010',
        warehouseId: warehouse.id,
        quantity: 150,
        stockType: 'physical',
      });

      const db = WmsTestDatabase.getDb();
      const receiveEvent = await db.query.stockEvents.findFirst({
        where: eq(wmsTables.stockEvents.transitionType, 'RECEIVE'),
      });

      expect(receiveEvent).toBeDefined();
    });

    it('should properly propagate transaction', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();

      await db.transaction(async (tx) => {
        await service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: 'variant-011',
          warehouseId: warehouse.id,
          quantity: 80,
          stockType: 'physical',
        }, tx);

        const eventsInTx = await tx.query.stockEvents.findMany({
          where: eq(wmsTables.stockEvents.skuId, sku.id),
        });

        expect(eventsInTx.length).toBeGreaterThan(0);
      });

      const eventsAfterCommit = await db.query.stockEvents.findMany({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(eventsAfterCommit.length).toBeGreaterThan(0);
    });
  });

  describe('Additional Features', () => {
    it('should handle subBarcode when provided', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-012',
        warehouseId: warehouse.id,
        quantity: 50,
        stockType: 'physical',
        subBarcode: '123456789',
      });

      expect(result.skuId).toBeDefined();
    });

    it('should handle packingUnit when provided', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-013',
        warehouseId: warehouse.id,
        quantity: 10,
        stockType: 'physical',
        packingUnit: 'BOX',
      });

      expect(result.skuId).toBeDefined();
    });

    it('should handle different stock types', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const stockTypes = ['physical', 'infinite', 'drop_shipped', 'consignment'] as const;

      for (const stockType of stockTypes) {
        const result = await service.createStockEntryBySkuId({
          skuId: sku.id,
          variantId: `variant-${stockType}`,
          warehouseId: warehouse.id,
          quantity: 25,
          stockType,
        });

        expect(result.skuId).toBeDefined();
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large quantities', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-large',
        warehouseId: warehouse.id,
        quantity: 999999,
        stockType: 'physical',
      });

      expect(result.skuId).toBeDefined();
    });

    it('should handle multiple concurrent entries for same SKU', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const entries: Promise<{ skuId: string; variantId: string | undefined }>[] = [];
      for (let i = 0; i < 5; i++) {
        entries.push(
          service.createStockEntryBySkuId({
            skuId: sku.id,
            variantId: `variant-concurrent-${i}`,
            warehouseId: warehouse.id,
            quantity: 20,
            stockType: 'physical',
          })
        );
      }

      const results = await Promise.all(entries);

      expect(results).toHaveLength(5);
    });

    it('should handle entry without location specified', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.createStockEntryBySkuId({
        skuId: sku.id,
        variantId: 'variant-no-loc',
        warehouseId: warehouse.id,
        quantity: 60,
        stockType: 'physical',
      });

      expect(result.skuId).toBeDefined();
    });

    it('should rollback on transaction failure', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();

      try {
        await db.transaction(async (tx) => {
          await service.createStockEntryBySkuId({
            skuId: sku.id,
            variantId: 'variant-rollback',
            warehouseId: warehouse.id,
            quantity: 100,
            stockType: 'physical',
          }, tx);

          throw new Error('Simulated error for rollback');
        });
      } catch (error) {
        // Expected error
      }

      const events = await db.query.stockEvents.findMany({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(events).toHaveLength(0);
    });
  });
});

