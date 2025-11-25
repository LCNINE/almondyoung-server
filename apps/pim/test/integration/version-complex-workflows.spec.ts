import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVersions, productMasters } from '../../src/schema';
import { eq, and, isNull } from 'drizzle-orm';

describe('Version Complex Workflows - Integration Tests', () => {
  let mastersService: ProductMastersService;
  let versionsService: ProductVersionsService;
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
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('Scenario 20: Multi-step update in draft', () => {
    it('should allow multiple updates to a single draft version', async () => {
      // 1. v1 draft 생성
      const v1 = await mastersService.createMaster({
        name: 'Initial Name',
      });

      expect(v1.versionStatus).toBe('draft');
      expect(v1.name).toBe('Initial Name');

      // 2. 첫 번째 수정
      await mastersService.updateVersion(v1.id, {
        name: 'Second Name',
        description: 'Added description',
      });

      let updated = await versionsService.getVersionById(v1.id);
      expect(updated.name).toBe('Second Name');
      expect(updated.description).toBe('Added description');

      // 3. 두 번째 수정
      await mastersService.updateVersion(v1.id, {
        brand: 'New Brand',
      });

      updated = await versionsService.getVersionById(v1.id);
      expect(updated.name).toBe('Second Name'); // 이전 변경 유지
      expect(updated.description).toBe('Added description');
      expect(updated.brand).toBe('New Brand');

      // 4. 세 번째 수정
      await mastersService.updateVersion(v1.id, {
        name: 'Final Name',
      });

      updated = await versionsService.getVersionById(v1.id);
      expect(updated.name).toBe('Final Name');
      expect(updated.description).toBe('Added description');
      expect(updated.brand).toBe('New Brand');

      // 5. 여전히 draft 상태
      expect(updated.versionStatus).toBe('draft');
    });
  });

  describe('Scenario 21: v1 active → v2 draft 생성 → v2 수정 중 v1 soft delete', () => {
    it('should keep v2 draft when v1 master is soft deleted', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 draft 생성
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 3. v2 수정 중
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2 - Work in Progress',
      });

      // 4. Master soft delete
      await mastersService.softDeleteMaster(v1.masterId, '019a0000-0000-0000-0000-000000ad1111');

      // 5. Master deletedAt 확인
      const [master] = await db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, v1.masterId));

      expect(master.deletedAt).not.toBeNull();

      // 6. v2 draft는 여전히 존재하고 수정 가능
      const v2Data = await versionsService.getVersionById(v2.id);
      expect(v2Data.versionStatus).toBe('draft');
      expect(v2Data.name).toBe('Product v2 - Work in Progress');

      // 7. v2를 계속 수정 가능
      await mastersService.updateVersion(v2.id, {
        description: 'Still editable',
      });

      const v2Updated = await versionsService.getVersionById(v2.id);
      expect(v2Updated.description).toBe('Still editable');
    });
  });

  describe('Scenario 22: v1 active → v2 draft → v3 draft (from v1)', () => {
    it('should allow two drafts to exist and be edited independently', async () => {
      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
        description: 'Original',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 draft 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000a11ce0', true);
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2',
        description: 'Alice branch',
      });

      // 3. v3 draft 생성 (also from v1)
      const v3 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-00000000b0b0', true);
      await mastersService.updateVersion(v3.id, {
        name: 'Product v3',
        description: 'Bob branch',
      });

      // 4. 두 draft 모두 존재 확인
      const v2Data = await versionsService.getVersionById(v2.id);
      const v3Data = await versionsService.getVersionById(v3.id);

      expect(v2Data.versionStatus).toBe('draft');
      expect(v3Data.versionStatus).toBe('draft');
      expect(v2Data.draftOwnerId).toBe('019a0000-0000-0000-0000-000000a11ce0');
      expect(v3Data.draftOwnerId).toBe('019a0000-0000-0000-0000-00000000b0b0');

      // 5. 각각 독립적으로 수정
      await mastersService.updateVersion(v2.id, {
        brand: 'Brand A',
      });

      await mastersService.updateVersion(v3.id, {
        brand: 'Brand B',
      });

      // 6. 변경 사항이 독립적인지 확인
      const v2Updated = await versionsService.getVersionById(v2.id);
      const v3Updated = await versionsService.getVersionById(v3.id);

      expect(v2Updated.name).toBe('Product v2');
      expect(v2Updated.brand).toBe('Brand A');
      expect(v3Updated.name).toBe('Product v3');
      expect(v3Updated.brand).toBe('Brand B');

      // 7. v2를 먼저 publish
      await versionsService.publishVersion(v2.id, 'active');

      // 8. v3는 여전히 draft
      const v3AfterV2Publish = await versionsService.getVersionById(v3.id);
      expect(v3AfterV2Publish.versionStatus).toBe('draft');
      expect(v3AfterV2Publish.brand).toBe('Brand B'); // 변경 사항 유지
    });
  });

  describe('Scenario 23: 롤백 플로우 (v1 → v2 publish → 문제 → v1에서 v3 생성)', () => {
    it('should rollback by creating new version from old stable version', async () => {
      // 1. v1 생성 및 publish (안정 버전)
      const v1 = await mastersService.createMaster({
        name: 'Product v1 - Stable',
        description: 'Stable version with no issues',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 생성 및 publish (문제가 있는 버전)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2 - Broken',
        description: 'This version has issues',
      });
      await versionsService.publishVersion(v2.id, 'active');

      // 3. v2가 active 상태 확인
      let activeVersion = await versionsService.getActiveVersion(v1.masterId);
      expect(activeVersion.id).toBe(v2.id);
      expect(activeVersion.name).toBe('Product v2 - Broken');

      // 4. 문제 발견! v1에서 v3 생성 (롤백)
      const v3 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000ad1111', true);

      // 5. v3는 v1의 데이터를 기반으로 함
      expect(v3.name).toBe('Product v1 - Stable');
      expect(v3.description).toBe('Stable version with no issues');
      expect(v3.parentVersionId).toBe(v1.id); // v2가 아닌 v1에서 분기

      // 6. 필요한 경우 v3 수정 (예: 버전 표시)
      await mastersService.updateVersion(v3.id, {
        name: 'Product v3 - Rollback to v1',
      });

      // 7. v3 publish (롤백 완료)
      await versionsService.publishVersion(v3.id, 'active');

      // 8. v3가 active, v2는 inactive
      activeVersion = await versionsService.getActiveVersion(v1.masterId);
      expect(activeVersion.id).toBe(v3.id);
      expect(activeVersion.name).toBe('Product v3 - Rollback to v1');

      const v2AfterRollback = await versionsService.getVersionById(v2.id);
      expect(v2AfterRollback.versionStatus).toBe('inactive');

      // 9. 버전 트리 확인
      const tree = await versionsService.getVersionTree(v1.masterId);

      // v1이 루트, v2와 v3가 v1의 자식
      expect(tree[0].version).toBe(1);
      expect(tree[0].children).toHaveLength(2);

      const childVersions = tree[0].children.map((c) => c.version).sort();
      expect(childVersions).toEqual([2, 3]);
    });
  });
});

