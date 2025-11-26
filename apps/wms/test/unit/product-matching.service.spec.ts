import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProductMatchingService } from '../../src/inventory/services/product-matching.service';
import { InventoryService } from '../../src/inventory/services/inventory.service';
import { StockEventService } from '../../src/inventory/services/stock-event.service';
import { WmsTestDatabase } from '../support/wms-test-database';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq } from 'drizzle-orm';

describe('ProductMatchingService - Phase 3 masterId Storage', () => {
  let service: ProductMatchingService;
  let module: TestingModule;
  let db: any;

  beforeAll(async () => {
    await WmsTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        ProductMatchingService,
        {
          provide: DbService,
          useFactory: () => ({
            db: WmsTestDatabase.getDb(),
          }),
        },
        {
          provide: InventoryService,
          useValue: {
            // Mock methods as needed
          },
        },
        {
          provide: StockEventService,
          useValue: {
            // Mock methods as needed
          },
        },
      ],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
    db = WmsTestDatabase.getDb();
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
  });

  describe('handleManualMatchingRequest', () => {
    it('✅ should store masterId in product_matchings table', async () => {
      const payload = {
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-789',
            name: 'Default',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      const [matching] = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, 'variant-uuid-789'));

      expect(matching).toBeDefined();
      expect(matching.masterId).toBe('master-uuid-123');
      expect(matching.variantId).toBe('variant-uuid-789');
      expect(matching.status).toBe('pending');
    });

    it('✅ should store masterId for multiple variants', async () => {
      const payload = {
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-1',
            name: 'Red',
            inventoryManagement: true,
            components: [],
          },
          {
            id: 'variant-uuid-2',
            name: 'Blue',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      const result = await service.handleManualMatchingRequest(payload);

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);

      const matchings = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.masterId, 'master-uuid-123'));

      expect(matchings).toHaveLength(2);
      expect(matchings[0].masterId).toBe('master-uuid-123');
      expect(matchings[1].masterId).toBe('master-uuid-123');
    });

    it('❌ should throw error if masterId is missing', async () => {
      const payload = {
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-789',
            name: 'Default',
            inventoryManagement: true,
            components: [],
          },
        ],
      } as any;

      await expect(service.handleManualMatchingRequest(payload)).rejects.toThrow(
        BadRequestException
      );
    });

    it('✅ should skip duplicate variants but still use correct masterId', async () => {
      const payload = {
        masterId: 'master-uuid-123',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-789',
            name: 'Default',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      const result1 = await service.handleManualMatchingRequest(payload);
      expect(result1.created).toBe(1);

      const result2 = await service.handleManualMatchingRequest(payload);
      expect(result2.skipped).toBe(1);

      const matchings = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, 'variant-uuid-789'));

      expect(matchings).toHaveLength(1);
      expect(matchings[0].masterId).toBe('master-uuid-123');
    });
  });

  describe('handleAutomaticMatchingRequest', () => {
    it('✅ should store masterId for non-inventory-managed variants', async () => {
      const payload = {
        masterId: 'master-uuid-456',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-999',
            name: 'Digital Product',
            inventoryManagement: false,
            components: [],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      const [matching] = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, 'variant-uuid-999'));

      expect(matching).toBeDefined();
      expect(matching.masterId).toBe('master-uuid-456');
      expect(matching.status).toBe('ignored');
      expect(matching.strategy).toBe('void');
    });

    it('✅ should store masterId for inventory-managed variants with variant strategy', async () => {
      const payload = {
        masterId: 'master-uuid-789',
        name: 'Test Product',
        variants: [
          {
            id: 'variant-uuid-111',
            name: 'Physical Product',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      const [matching] = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, 'variant-uuid-111'));

      expect(matching).toBeDefined();
      expect(matching.masterId).toBe('master-uuid-789');
      expect(matching.status).toBe('matched');
      expect(matching.strategy).toBe('variant');
    });
  });

  describe('Backward Compatibility', () => {
    it('✅ should accept null masterId for existing data', async () => {
      await db.insert(wmsTables.productMatchings).values({
        variantId: 'legacy-variant-uuid',
        masterId: null,
        status: 'pending',
        priority: 'normal',
        strategy: null,
        isResolved: false,
      });

      const [matching] = await db
        .select()
        .from(wmsTables.productMatchings)
        .where(eq(wmsTables.productMatchings.variantId, 'legacy-variant-uuid'));

      expect(matching).toBeDefined();
      expect(matching.masterId).toBeNull();
    });
  });
});

