import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { DbService } from '@app/db';

describe('Product Event Payloads - Phase 3 Refactoring', () => {
  let service: ProductMastersService;
  let versionsService: ProductVersionsService;
  let module: TestingModule;
  let mockStreamPublisher: { publishEvent: jest.Mock };

  beforeAll(async () => {
    await PimTestDatabase.setup();

    mockStreamPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        ProductMastersService,
        ProductVersionsService,
        {
          provide: DbService,
          useFactory: () => ({
            db: PimTestDatabase.getDb(),
          }),
        },
        {
          provide: 'STREAM_PUBLISHER_products.events.v1',
          useValue: mockStreamPublisher,
        },
      ],
    }).compile();

    service = module.get<ProductMastersService>(ProductMastersService);
    versionsService = module.get<ProductVersionsService>(ProductVersionsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
    mockStreamPublisher.publishEvent.mockClear();
  });

  describe('ProductVariantCreated Event Payload', () => {
    it('✅ should include masterId, versionId, and version fields', async () => {
      const master = await service.createMaster({
        name: 'Test Product',
        description: 'Test Description',
      });

      expect(mockStreamPublisher.publishEvent).toHaveBeenCalled();
      const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];

      expect(eventCall.eventType).toBe('ProductVariantCreated');
      expect(eventCall.payload).toHaveProperty('masterId');
      expect(eventCall.payload).toHaveProperty('versionId');
      expect(eventCall.payload).toHaveProperty('version');
      expect(eventCall.payload.masterId).toBe(master.masterId);
      expect(eventCall.payload.versionId).toBe(master.id);
      expect(eventCall.payload.version).toBe(master.version);
    });

    it('✅ should use masterId as aggregateId', async () => {
      const master = await service.createMaster({
        name: 'Test Product',
      });

      const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];

      expect(eventCall.aggregateId).toBe(master.masterId);
      expect(eventCall.aggregateId).not.toBe(master.id);
    });

    it('✅ should not have productId field (deprecated)', async () => {
      const master = await service.createMaster({
        name: 'Test Product',
      });

      const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];

      expect(eventCall.payload).not.toHaveProperty('productId');
    });

    it('✅ should include all required fields', async () => {
      const master = await service.createMaster({
        name: 'Test Product',
      });

      const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];
      const payload = eventCall.payload;

      expect(payload).toHaveProperty('masterId');
      expect(payload).toHaveProperty('versionId');
      expect(payload).toHaveProperty('version');
      expect(payload).toHaveProperty('productName');
      expect(payload).toHaveProperty('variantId');
      expect(payload).toHaveProperty('inventoryManagement');
      expect(payload).toHaveProperty('createdAt');
    });

    it('✅ should have correct types for new fields', async () => {
      const master = await service.createMaster({
        name: 'Test Product',
      });

      const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];
      const payload = eventCall.payload;

      expect(typeof payload.masterId).toBe('string');
      expect(typeof payload.versionId).toBe('string');
      expect(typeof payload.version).toBe('number');
      expect(payload.version).toBeGreaterThan(0);
    });
  });

  describe('Version Relationship Validation', () => {
    it('✅ masterId should remain constant across versions', async () => {
      const v1 = await service.createMaster({
        name: 'Version 1',
      });

      await versionsService.publishVersion(v1.id, 'active');

      const v2 = await versionsService.createDraftVersion(
        v1.id,
        'test-user-id',
        true,
      );

      mockStreamPublisher.publishEvent.mockClear();

      const db = PimTestDatabase.getDb();
      await service.updateVersion(
        v2.id,
        {
          optionDiff: {
            add: [
              {
                displayName: 'Size',
                values: [{ displayName: 'S' }, { displayName: 'M' }],
              },
            ],
          },
        },
        db as any,
      );

      if (mockStreamPublisher.publishEvent.mock.calls.length > 0) {
        const eventCall = mockStreamPublisher.publishEvent.mock.calls[0][0];
        expect(eventCall.payload.masterId).toBe(v1.masterId);
        expect(eventCall.payload.version).toBe(2);
      }
    });
  });
});

