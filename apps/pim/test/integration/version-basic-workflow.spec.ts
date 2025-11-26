import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasters, productMasterVersions } from '../../src/schema';
import { eq, and, isNull } from 'drizzle-orm';

describe('Version Basic Workflow - Integration Tests', () => {
  let mastersService: ProductMastersService;
  let versionsService: ProductVersionsService;
  let pricingService: PricingService;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    const mockStreamPublisher = {
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
    pricingService = module.get<PricingService>(PricingService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('Scenario 1: Master + v1 draft 생성 → 수정 → publish (active)', () => {
    it('should create master with v1 draft, update it, and publish to active', async () => {
      const db = PimTestDatabase.getDb();

      // 1. Master + v1 draft 생성
      const v1 = await mastersService.createMaster({
        name: 'Test Product v1',
      });

      expect(v1.masterId).toBeDefined();
      expect(v1.version).toBe(1);
      expect(v1.versionStatus).toBe('draft');
      expect(v1.name).toBe('Test Product v1');

      // 2. v1 draft 수정
      const updated = await mastersService.updateVersion(v1.id, {
        name: 'Updated Product v1',
        description: 'This is version 1',
        brand: 'Test Brand',
      });

      expect(updated.name).toBe('Updated Product v1');
      expect(updated.description).toBe('This is version 1');
      expect(updated.brand).toBe('Test Brand');
      expect(updated.versionStatus).toBe('draft');

      // 3. v1 draft를 active로 publish
      await versionsService.publishVersion(v1.id, 'active');

      const published = await versionsService.getVersionById(v1.id);
      expect(published.versionStatus).toBe('active');
      expect(published.draftOwnerId).toBeNull();

      // 4. active 버전 조회 확인
      const activeVersion = await versionsService.getActiveVersion(v1.masterId);
      expect(activeVersion.id).toBe(v1.id);
      expect(activeVersion.name).toBe('Updated Product v1');
    });
  });

  describe('Scenario 2: v2 draft 생성 (from v1) → 수정 → publish', () => {
    it('should create v2 from v1, update, publish, and make v1 inactive', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
        description: 'Original version',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 draft 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(
        v1.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );

      expect(v2.version).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);
      expect(v2.versionStatus).toBe('draft');
      expect(v2.name).toBe('Product v1'); // 부모 필드 복사 확인
      expect(v2.description).toBe('Original version');

      // 3. v2 수정
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2',
        description: 'Updated version',
      });

      // 4. v2 publish → v1 inactive
      await versionsService.publishVersion(v2.id, 'active');

      const v1Updated = await versionsService.getVersionById(v1.id);
      const v2Published = await versionsService.getVersionById(v2.id);

      expect(v1Updated.versionStatus).toBe('inactive');
      expect(v2Published.versionStatus).toBe('active');

      // 5. active 버전이 v2인지 확인
      const activeVersion = await versionsService.getActiveVersion(v1.masterId);
      expect(activeVersion.id).toBe(v2.id);
      expect(activeVersion.name).toBe('Product v2');
    });
  });

  describe('Scenario 3: v3 draft 생성 (from v1, not v2) → publish', () => {
    it('should create v3 branching from v1, publish, and make v2 inactive', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 생성 및 publish
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2',
      });
      await versionsService.publishVersion(v2.id, 'active');

      // 3. v3 생성 (from v1, not v2) - 분기
      const v3 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000456', true);

      expect(v3.version).toBe(3);
      expect(v3.parentVersionId).toBe(v1.id); // v2가 아닌 v1에서 분기
      expect(v3.name).toBe('Product v1'); // v1의 필드 복사

      // 4. v3 수정 및 publish
      await mastersService.updateVersion(v3.id, {
        name: 'Product v3 (branched from v1)',
      });
      await versionsService.publishVersion(v3.id, 'active');

      // 5. v2는 inactive, v3는 active
      const v2Updated = await versionsService.getVersionById(v2.id);
      const v3Published = await versionsService.getVersionById(v3.id);

      expect(v2Updated.versionStatus).toBe('inactive');
      expect(v3Published.versionStatus).toBe('active');

      // 6. active 버전이 v3인지 확인
      const activeVersion = await versionsService.getActiveVersion(v1.masterId);
      expect(activeVersion.id).toBe(v3.id);
      expect(activeVersion.name).toBe('Product v3 (branched from v1)');
    });
  });

  describe('Scenario 4: Master soft delete → 복구', () => {
    it('should soft delete master and restore it', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product for deletion test',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. Master soft delete
      await mastersService.softDeleteMaster(v1.masterId, '019a0000-0000-0000-0000-000000ad1111');

      // 3. Master 삭제 확인 (deletedAt 필드)
      const [deletedMaster] = await db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, v1.masterId));

      expect(deletedMaster.deletedAt).not.toBeNull();
      expect(deletedMaster.deletedBy).toBe('019a0000-0000-0000-0000-000000ad1111');

      // 4. Active 버전 조회 시 제외되는지 확인
      const activeBefore = await db
        .select()
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, v1.masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        );
      expect(activeBefore).toHaveLength(1); // 버전 자체는 여전히 존재

      // 5. Master 복구
      await mastersService.restoreMaster(v1.masterId, '019a0000-0000-0000-0000-000000ad1111');

      // 6. Master 복구 확인 (deletedAt = null)
      const [restoredMaster] = await db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, v1.masterId));

      expect(restoredMaster.deletedAt).toBeNull();
      expect(restoredMaster.deletedBy).toBeNull();

      // 7. Active 버전 조회 성공 확인
      const activeAfter = await versionsService.getActiveVersion(v1.masterId);
      expect(activeAfter.id).toBe(v1.id);
      expect(activeAfter.name).toBe('Product for deletion test');
    });
  });
});

