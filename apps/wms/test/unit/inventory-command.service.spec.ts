import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InventoryCommandService } from '../../src/inventory/services/inventory-command.service';
import { StockEventStore } from '../../src/inventory/repositories/stock-event.store';
import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';

describe('InventoryCommandService - Unit Tests', () => {
  let service: InventoryCommandService;
  let eventStore: StockEventStore;
  let module: TestingModule;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        InventoryCommandService,
        StockEventStore,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<InventoryCommandService>(InventoryCommandService);
    eventStore = module.get<StockEventStore>(StockEventStore);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('Receive Operations', () => {
    it('should receive stock with positive quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'RECV-LOC',
        locationType: 'standard',
      }).returning();

      const result = await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        toLocationId: location.id,
        quantity: 100,
        reason: 'Initial stock',
      });

      expect(result).toBeDefined();
      expect(result.eventId).toBeDefined();

      const events = await db.query.stockEvents.findMany({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].transitionType).toBe('RECEIVE');
      expect(events[0].quantity).toBe(100);
    });

    it('should fail to receive with zero quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await expect(
        service.receive({
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          quantity: 0,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should fail to receive with negative quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await expect(
        service.receive({
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          quantity: -50,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle idempotencyKey for duplicate calls', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const idempotencyKey = 'unique-receive-001';

      const result1 = await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 50,
        idempotencyKey,
      });

      const result2 = await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 50,
        idempotencyKey,
      });

      expect(result1.eventId).toBe(result2.eventId);

      const db = WmsTestDatabase.getDb();
      const events = await db.query.stockEvents.findMany({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.idempotencyKey, idempotencyKey)
        ),
      });

      expect(events).toHaveLength(1);
    });

    it('should create stock event correctly', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const occurredAt = new Date('2024-01-15T10:00:00Z');

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 75,
        occurredAt,
        reason: 'Test receive',
      });

      const db = WmsTestDatabase.getDb();
      const event = await db.query.stockEvents.findFirst({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(event).toBeDefined();
      expect(event!.transitionType).toBe('RECEIVE');
      expect(event!.quantity).toBe(75);
      expect(event!.toState).toBe('ON_HAND');
      expect(event!.reason).toBe('Test receive');
    });
  });

  describe('Ship Operations', () => {
    it('should ship stock reducing quantity', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'SHIP-LOC',
        locationType: 'standard',
      }).returning();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        toLocationId: location.id,
        quantity: 100,
      });

      const result = await service.ship({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        quantity: 30,
        reason: 'Order fulfillment',
      });

      expect(result).toBeDefined();
      expect(result.eventId).toBeDefined();
    });

    it('should create SHIP event', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 100,
      });

      await service.ship({
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 25,
      });

      const db = WmsTestDatabase.getDb();
      const shipEvent = await db.query.stockEvents.findFirst({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.transitionType, 'SHIP')
        ),
      });

      expect(shipEvent).toBeDefined();
      expect(shipEvent!.quantity).toBe(25);
    });

    it('should ship from specific location', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [location] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'SPECIFIC-LOC',
        locationType: 'standard',
      }).returning();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        toLocationId: location.id,
        quantity: 200,
      });

      await service.ship({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        quantity: 50,
      });

      const shipEvent = await db.query.stockEvents.findFirst({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.transitionType, 'SHIP'),
          eq(wmsTables.stockEvents.fromLocationId, location.id)
        ),
      });

      expect(shipEvent).toBeDefined();
      expect(shipEvent!.fromLocationId).toBe(location.id);
    });
  });

  describe('Adjust Operations', () => {
    it('should adjust stock upward (increase)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 50,
      });

      const result = await service.adjustUp({
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 20,
        reason: 'Found additional units',
      });

      expect(result).toBeDefined();
    });

    it('should adjust stock downward (decrease)', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 100,
      });

      const result = await service.adjustDown({
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 15,
        reason: 'Damaged units removed',
      });

      expect(result).toBeDefined();
    });

    it('should include reason field in adjustment', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 75,
      });

      await service.adjustUp({
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity: 10,
        reason: 'Stocktake adjustment',
      });

      const db = WmsTestDatabase.getDb();
      const adjustEvent = await db.query.stockEvents.findFirst({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.transitionType, 'ADJUST_UP')
        ),
      });

      expect(adjustEvent).toBeDefined();
      expect(adjustEvent!.reason).toBe('Stocktake adjustment');
    });
  });

  describe('Transfer Operations', () => {
    it('should transfer between locations in same warehouse', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();
      const [fromLocation] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'FROM-LOC',
        locationType: 'standard',
      }).returning();

      const [toLocation] = await db.insert(wmsTables.locations).values({
        warehouseId: warehouse.id,
        code: 'TO-LOC',
        locationType: 'standard',
      }).returning();

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        toLocationId: fromLocation.id,
        quantity: 100,
      });

      const result = await service.moveInternal({
        skuId: sku.id,
        warehouseId: warehouse.id,
        fromLocationId: fromLocation.id,
        toLocationId: toLocation.id,
        quantity: 40,
      });

      expect(result).toBeDefined();

      const transferEvents = await db.query.stockEvents.findMany({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.transitionType, 'MOVE')
        ),
      });

      expect(transferEvents.length).toBeGreaterThan(0);
    });

    it('should transfer between warehouses', async () => {
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

      await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse1.id,
        toLocationId: loc1.id,
        quantity: 200,
      });

      await service.transferShip({
        skuId: sku.id,
        fromWarehouseId: warehouse1.id,
        fromLocationId: loc1.id,
        quantity: 60,
      });

      await service.transferReceive({
        skuId: sku.id,
        toWarehouseId: warehouse2.id,
        toLocationId: loc2.id,
        quantity: 60,
      });

      const transferEvents = await db.query.stockEvents.findMany({
        where: and(
          eq(wmsTables.stockEvents.skuId, sku.id),
          eq(wmsTables.stockEvents.transitionType, 'MOVE')
        ),
      });

      expect(transferEvents.length).toBeGreaterThan(0);
      const shipEvent = transferEvents.find(e => e.fromWarehouseId === warehouse1.id);
      const receiveEvent = transferEvents.find(e => e.toWarehouseId === warehouse2.id);
      expect(shipEvent).toBeDefined();
      expect(receiveEvent).toBeDefined();
    });
  });

  describe('Transaction Behavior', () => {
    it('should rollback on error mid-operation', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();

      try {
        await db.transaction(async (tx) => {
          await service.receive({
            skuId: sku.id,
            toWarehouseId: warehouse.id,
            quantity: 100,
          }, tx as any);

          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected error
      }

      const events = await db.query.stockEvents.findMany({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(events).toHaveLength(0);
    });

    it('should pass transaction correctly to eventStore', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();

      await db.transaction(async (tx) => {
        const result = await service.receive({
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          quantity: 150,
        }, tx as any);

        expect(result.eventId).toBeDefined();

        const eventInTx = await tx.query.stockEvents.findFirst({
          where: eq(wmsTables.stockEvents.id, result.eventId!),
        });

        expect(eventInTx).toBeDefined();
      });
    });

    it('should commit all changes when transaction succeeds', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const db = WmsTestDatabase.getDb();

      await db.transaction(async (tx) => {
        await service.receive({
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          quantity: 100,
        }, tx as any);

        await service.ship({
          skuId: sku.id,
          warehouseId: warehouse.id,
          quantity: 30,
        }, tx as any);
      });

      const events = await db.query.stockEvents.findMany({
        where: eq(wmsTables.stockEvents.skuId, sku.id),
      });

      expect(events).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large quantities', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 1000000,
      });

      expect(result).toBeDefined();
    });

    it('should handle rapid successive operations', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const operations = Array.from({ length: 10 }, () =>
        service.receive({
          skuId: sku.id,
          toWarehouseId: warehouse.id,
          quantity: 10,
        })
      );

      const results = await Promise.all(operations);

      expect(results).toHaveLength(10);
      results.forEach(r => expect(r.eventId).toBeDefined());
    });

    it('should handle operations without location specified', async () => {
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku();

      const result = await service.receive({
        skuId: sku.id,
        toWarehouseId: warehouse.id,
        quantity: 50,
      });

      expect(result).toBeDefined();

      const db = WmsTestDatabase.getDb();
      const event = await db.query.stockEvents.findFirst({
        where: eq(wmsTables.stockEvents.id, result.eventId!),
      });

      expect(event!.toLocationId).toBeNull();
    });
  });
});

