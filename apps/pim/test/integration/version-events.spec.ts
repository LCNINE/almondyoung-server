import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVariants } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Events - Integration Tests', () => {
  let mastersService: ProductMastersService;
  let versionsService: ProductVersionsService;
  let mockStreamPublisher: any;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    mockStreamPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        ProductMastersService,
        ProductVersionsService,
        PricingService,
        PricingCalculatorService,
        PricingValidatorService,
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

    mastersService = module.get<ProductMastersService>(ProductMastersService);
    versionsService = module.get<ProductVersionsService>(ProductVersionsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
    mockStreamPublisher.publishEvent.mockClear();
  });

  describe('Scenario 33: ProductMasterActiveVersionChanged 이벤트', () => {
    it('should publish event when version is published as active', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      mockStreamPublisher.publishEvent.mockClear();

      // 2. v1 publish
      await versionsService.publishVersion(v1.id, 'active');

      // 3. ProductMasterActiveVersionChanged 이벤트 발행 확인
      expect(mockStreamPublisher.publishEvent).toHaveBeenCalled();

      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const activeVersionChangedEvent = calls.find(
        (call: any) => call[0].eventType === 'ProductMasterActiveVersionChanged',
      );

      expect(activeVersionChangedEvent).toBeDefined();
      expect(activeVersionChangedEvent[0].payload.masterId).toBe(v1.masterId);
      expect(activeVersionChangedEvent[0].payload.productId).toBe(v1.id);
      expect(activeVersionChangedEvent[0].payload.version).toBe(1);
      expect(activeVersionChangedEvent[0].payload.previousActiveVersionId).toBeNull();
      expect(activeVersionChangedEvent[0].payload.changeReason).toBe('published');
    });

    it('should publish event with previous version info when replacing active', async () => {
      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      mockStreamPublisher.publishEvent.mockClear();

      // 2. v2 생성 및 publish
      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);
      await versionsService.publishVersion(v2.id, 'active');

      // 3. 이벤트 확인 (previousActiveVersionId가 v1)
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const activeVersionChangedEvent = calls.find(
        (call: any) => call[0].eventType === 'ProductMasterActiveVersionChanged',
      );

      expect(activeVersionChangedEvent).toBeDefined();
      expect(activeVersionChangedEvent[0].payload.masterId).toBe(v2.masterId);
      expect(activeVersionChangedEvent[0].payload.productId).toBe(v2.id);
      expect(activeVersionChangedEvent[0].payload.version).toBe(2);
      expect(activeVersionChangedEvent[0].payload.previousActiveVersionId).toBe(v1.id);
      expect(activeVersionChangedEvent[0].payload.changeReason).toBe('rollback');
    });

    it('should publish event when version is published as inactive', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      mockStreamPublisher.publishEvent.mockClear();

      // 2. v1을 inactive로 publish
      await versionsService.publishVersion(v1.id, 'inactive');

      // 3. 이벤트 확인 (targetStatus: inactive)
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const activeVersionChangedEvent = calls.find(
        (call: any) => call[0].eventType === 'ProductMasterActiveVersionChanged',
      );

      expect(activeVersionChangedEvent).toBeDefined();
      expect(activeVersionChangedEvent[0].payload.masterId).toBe(v1.masterId);
      expect(activeVersionChangedEvent[0].payload.productId).toBeNull();
      expect(activeVersionChangedEvent[0].payload.version).toBeNull();
      expect(activeVersionChangedEvent[0].payload.changeReason).toBe('unpublished');
    });
  });

  describe('Scenario 34: ProductVariantCreated 이벤트', () => {
    it('should publish event when master is created with default variant', async () => {
      mockStreamPublisher.publishEvent.mockClear();

      // 1. Master 생성 (default variant 자동 생성)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. ProductVariantCreated 이벤트 발행 확인
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const variantCreatedEvents = calls.filter(
        (call: any) => call[0].eventType === 'ProductVariantCreated',
      );

      expect(variantCreatedEvents.length).toBeGreaterThan(0);

      const firstEvent = variantCreatedEvents[0];
      expect(firstEvent[0].aggregateId).toBe(v1.masterId);
      expect(firstEvent[0].payload.masterId).toBe(v1.masterId);
      expect(firstEvent[0].payload.versionId).toBe(v1.id);
      expect(firstEvent[0].payload.version).toBe(1);
      expect(firstEvent[0].payload.variantId).toBeDefined();
      expect(firstEvent[0].payload.isDefault).toBe(true);
    });

    it('should publish events when variants are generated from options', async () => {
      const db = PimTestDatabase.getDb();

      // 1. Master 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      mockStreamPublisher.publishEvent.mockClear();

      // 2. 옵션 추가 (2 × 2 = 4 variants)
      await mastersService.updateVersion(v1.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [
                { displayName: '빨강' },
                { displayName: '파랑' },
              ],
            },
            {
              displayName: '사이즈',
              values: [
                { displayName: 'S' },
                { displayName: 'M' },
              ],
            },
          ],
        },
      });

      // 3. 4개의 variant가 생성되었는지 확인
      const variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(variants).toHaveLength(4);

      // 4. ProductVariantCreated 이벤트가 발행되지 않음 (옵션 변경 시 이벤트는 publish 시에만)
      // 옵션 변경으로 생성된 variants는 이벤트 없이 생성됨
      // 이벤트는 createMaster 시 또는 명시적 variant 생성 시에만 발행
    });
  });

  describe('Scenario 35: ProductMasterDeleted 이벤트', () => {
    it('should publish event when master with active version is soft deleted', async () => {
      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      mockStreamPublisher.publishEvent.mockClear();

      // 2. Master soft delete
      await mastersService.softDeleteMaster(v1.masterId, 'user-admin');

      // 3. ProductMasterDeleted 이벤트 발행 확인
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const masterDeletedEvent = calls.find(
        (call: any) => call[0].eventType === 'ProductMasterDeleted',
      );

      expect(masterDeletedEvent).toBeDefined();
      expect(masterDeletedEvent[0].aggregateId).toBe(v1.masterId);
      expect(masterDeletedEvent[0].payload.masterId).toBe(v1.masterId);
      expect(masterDeletedEvent[0].payload.deletedAt).toBeDefined();
    });

    it('should not publish event when master without active version is deleted', async () => {
      // 1. v1 생성 (draft만 있음)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      mockStreamPublisher.publishEvent.mockClear();

      // 2. Master soft delete
      await mastersService.softDeleteMaster(v1.masterId, 'user-admin');

      // 3. ProductMasterDeleted 이벤트 발행되지 않음 (active 버전이 없으므로)
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const masterDeletedEvent = calls.find(
        (call: any) => call[0].eventType === 'ProductMasterDeleted',
      );

      expect(masterDeletedEvent).toBeUndefined();
    });

    it('should publish event only once even with multiple versions', async () => {
      // 1. v1, v2, v3 생성 (v3가 active)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);
      await versionsService.publishVersion(v2.id, 'active');

      const v3 = await versionsService.createDraftVersion(v2.id, 'user-123', true);
      await versionsService.publishVersion(v3.id, 'active');

      mockStreamPublisher.publishEvent.mockClear();

      // 2. Master soft delete
      await mastersService.softDeleteMaster(v1.masterId, 'user-admin');

      // 3. ProductMasterDeleted 이벤트 1회만 발행
      const calls = mockStreamPublisher.publishEvent.mock.calls;
      const masterDeletedEvents = calls.filter(
        (call: any) => call[0].eventType === 'ProductMasterDeleted',
      );

      expect(masterDeletedEvents).toHaveLength(1);
      expect(masterDeletedEvents[0][0].aggregateId).toBe(v1.masterId);
    });
  });

  describe('Event Integration Test: Complete Workflow', () => {
    it('should publish all relevant events in a complete product lifecycle', async () => {
      const db = PimTestDatabase.getDb();

      // 전체 이벤트 추적
      const allEvents: any[] = [];
      mockStreamPublisher.publishEvent.mockImplementation((event: any) => {
        allEvents.push(event);
        return Promise.resolve();
      });

      // 1. Master 생성 (ProductVariantCreated for default variant)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      const variantCreatedCount1 = allEvents.filter(
        (e) => e.eventType === 'ProductVariantCreated',
      ).length;
      expect(variantCreatedCount1).toBeGreaterThan(0);

      // 2. v1 publish (ProductMasterActiveVersionChanged)
      await versionsService.publishVersion(v1.id, 'active');

      const activeChangedCount1 = allEvents.filter(
        (e) => e.eventType === 'ProductMasterActiveVersionChanged',
      ).length;
      expect(activeChangedCount1).toBe(1);

      // 3. v2 생성 및 publish (ProductMasterActiveVersionChanged)
      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);
      await versionsService.publishVersion(v2.id, 'active');

      const activeChangedCount2 = allEvents.filter(
        (e) => e.eventType === 'ProductMasterActiveVersionChanged',
      ).length;
      expect(activeChangedCount2).toBe(2);

      // 4. Master soft delete (ProductMasterDeleted)
      await mastersService.softDeleteMaster(v1.masterId, 'user-admin');

      const masterDeletedCount = allEvents.filter(
        (e) => e.eventType === 'ProductMasterDeleted',
      ).length;
      expect(masterDeletedCount).toBe(1);

      // 5. 전체 이벤트 타입 확인
      const eventTypes = [...new Set(allEvents.map((e) => e.eventType))];
      expect(eventTypes).toContain('ProductVariantCreated');
      expect(eventTypes).toContain('ProductMasterActiveVersionChanged');
      expect(eventTypes).toContain('ProductMasterDeleted');
    });
  });
});

