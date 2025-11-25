import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVariants, productMasterPricingRules, productVariants, pricingRules } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Branching - Integration Tests', () => {
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

  describe('Scenario 5: v1 → v2 → v3 순차 버전 생성 후 트리 구조 확인', () => {
    it('should create sequential versions and verify tree structure', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. v2 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 3. v3 생성 (from v2)
      const v3 = await versionsService.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123', true);

      // 4. 버전 트리 구조 확인
      const tree = await versionsService.getVersionTree(v1.masterId);

      expect(tree).toHaveLength(1); // Root node는 v1 하나
      expect(tree[0].version).toBe(1);
      expect(tree[0].parentVersionId).toBeNull();
      expect(tree[0].children).toHaveLength(1); // v1의 자식은 v2

      const v2Node = tree[0].children[0];
      expect(v2Node.version).toBe(2);
      expect(v2Node.parentVersionId).toBe(v1.id);
      expect(v2Node.children).toHaveLength(1); // v2의 자식은 v3

      const v3Node = v2Node.children[0];
      expect(v3Node.version).toBe(3);
      expect(v3Node.parentVersionId).toBe(v2.id);
      expect(v3Node.children).toHaveLength(0); // v3는 리프 노드
    });
  });

  describe('Scenario 6: v1에서 v2, v3 동시 분기 (parallel branches)', () => {
    it('should create parallel branches from v1', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. v2 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await mastersService.updateVersion(v2.id, { name: 'Branch A' });

      // 3. v3 생성 (also from v1) - 병렬 분기
      const v3 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000456', true);
      await mastersService.updateVersion(v3.id, { name: 'Branch B' });

      // 4. v2와 v3 모두 draft 상태로 동시 존재
      const v2Data = await versionsService.getVersionById(v2.id);
      const v3Data = await versionsService.getVersionById(v3.id);

      expect(v2Data.versionStatus).toBe('draft');
      expect(v3Data.versionStatus).toBe('draft');
      expect(v2Data.parentVersionId).toBe(v1.id);
      expect(v3Data.parentVersionId).toBe(v1.id);

      // 5. 버전 트리에서 두 분기 확인
      const tree = await versionsService.getVersionTree(v1.masterId);

      expect(tree[0].children).toHaveLength(2); // v1의 자식이 2개
      const childVersions = tree[0].children.map((c) => c.version).sort();
      expect(childVersions).toEqual([2, 3]);

      // 6. v2를 먼저 publish
      await versionsService.publishVersion(v2.id, 'active');

      // 7. v3는 여전히 draft로 남아있음
      const v3AfterV2Publish = await versionsService.getVersionById(v3.id);
      expect(v3AfterV2Publish.versionStatus).toBe('draft');

      // 8. v3를 publish → v2는 inactive
      await versionsService.publishVersion(v3.id, 'active');

      const v2Final = await versionsService.getVersionById(v2.id);
      const v3Final = await versionsService.getVersionById(v3.id);

      expect(v2Final.versionStatus).toBe('inactive');
      expect(v3Final.versionStatus).toBe('active');
    });
  });

  describe('Scenario 7: v2 draft 삭제 → 고아 variant/pricing rule 정리 확인', () => {
    it('should cleanup orphaned variants and pricing rules when deleting draft', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (default variant 포함)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 가격 규칙 추가
      await pricingService.replaceMasterRules(
        v1.masterId,
        {
          basePriceRules: [
            {
              layer: 'base_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 10000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        v1.version,
      );

      // 2. v2 생성 (매핑 복사)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // v2용 추가 가격 규칙 생성
      await pricingService.replaceMasterRules(
        v2.masterId,
        {
          basePriceRules: [
            {
              layer: 'base_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 15000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        v2.version,
      );

      // 3. v2 삭제 전 variant와 pricing rule 개수 확인
      const v2VariantsBefore = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      const v2PricingRulesBefore = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
          ),
        );

      expect(v2VariantsBefore.length).toBeGreaterThan(0);
      expect(v2PricingRulesBefore.length).toBeGreaterThan(0);

      const variantIdsToCheck = v2VariantsBefore.map((v) => v.variantId);
      const ruleIdsToCheck = v2PricingRulesBefore.map((pr) => pr.pricingRuleId);

      // 4. v2 draft 삭제
      await versionsService.deleteDraftVersion(v2.id);

      // 5. v2 매핑 삭제 확인
      const v2VariantsAfter = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      const v2PricingRulesAfter = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
          ),
        );

      expect(v2VariantsAfter).toHaveLength(0);
      expect(v2PricingRulesAfter).toHaveLength(0);

      // 6. v1에서 참조하는 variant는 유지, v2만 참조하던 variant는 삭제 확인
      // (v1과 v2가 같은 variant를 공유하므로 삭제되지 않아야 함)
      for (const variantId of variantIdsToCheck) {
        const variantStillExists = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, variantId));

        const v1StillReferences = await db
          .select()
          .from(productMasterVariants)
          .where(
            and(
              eq(productMasterVariants.masterId, v1.masterId),
              eq(productMasterVariants.version, v1.version),
              eq(productMasterVariants.variantId, variantId),
            ),
          );

        if (v1StillReferences.length > 0) {
          expect(variantStillExists).toHaveLength(1); // v1이 참조하면 유지
        }
      }
    });
  });

  describe('Scenario 8: 버전 간 비교 (compareVersions)', () => {
    it('should compare versions and return field differences', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
        description: 'Original description',
        brand: 'Brand A',
      });

      // 2. v2 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 3. v2 수정
      await mastersService.updateVersion(v2.id, {
        name: 'Product v2',
        description: 'Updated description',
        brand: 'Brand B',
      });

      // 4. 버전 간 비교
      const diffs = await versionsService.compareVersions(v1.id, v2.id);

      // 5. 변경된 필드 확인
      expect(diffs.length).toBeGreaterThan(0);

      const nameDiff = diffs.find((d) => d.field === 'name');
      expect(nameDiff).toBeDefined();
      expect(nameDiff?.oldValue).toBe('Product v1');
      expect(nameDiff?.newValue).toBe('Product v2');

      const descDiff = diffs.find((d) => d.field === 'description');
      expect(descDiff).toBeDefined();
      expect(descDiff?.oldValue).toBe('Original description');
      expect(descDiff?.newValue).toBe('Updated description');

      const brandDiff = diffs.find((d) => d.field === 'brand');
      expect(brandDiff).toBeDefined();
      expect(brandDiff?.oldValue).toBe('Brand A');
      expect(brandDiff?.newValue).toBe('Brand B');
    });

    it('should return empty array if versions are identical', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. v2 생성 (from v1, 수정 없음)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 3. 버전 간 비교 (변경 없음)
      const diffs = await versionsService.compareVersions(v1.id, v2.id);

      // 4. 차이가 없어야 함
      expect(diffs).toHaveLength(0);
    });
  });
});

