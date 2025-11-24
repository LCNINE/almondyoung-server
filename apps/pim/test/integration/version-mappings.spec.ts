import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterCategories, productTagValues } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Mappings (Categories & Tags) - Integration Tests', () => {
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

  describe('Scenario 17: v1 카테고리 A, B → v2 카테고리 B, C', () => {
    it('should maintain independent category mappings per version', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 카테고리 A, B, C 생성
      const categoryA = await PimTestFactory.createCategory({
        name: 'Category A',
        slug: 'category-a',
      }, db);
      const categoryB = await PimTestFactory.createCategory({
        name: 'Category B',
        slug: 'category-b',
      }, db);
      const categoryC = await PimTestFactory.createCategory({
        name: 'Category C',
        slug: 'category-c',
      }, db);

      // 2. v1 생성 및 카테고리 A, B 연결
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      await mastersService.updateVersion(v1.id, {
        categoryIds: [categoryA.id, categoryB.id],
      });

      // 3. v1 카테고리 매핑 확인
      const v1Categories = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v1.masterId),
            eq(productMasterCategories.version, v1.version),
          ),
        );

      expect(v1Categories).toHaveLength(2);
      const v1CategoryIds = v1Categories.map((c) => c.categoryId).sort();
      expect(v1CategoryIds).toEqual([categoryA.id, categoryB.id].sort());

      // 4. v2 생성 및 카테고리 B, C로 변경
      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);

      await mastersService.updateVersion(v2.id, {
        categoryIds: [categoryB.id, categoryC.id],
      });

      // 5. v2 카테고리 매핑 확인
      const v2Categories = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v2.masterId),
            eq(productMasterCategories.version, v2.version),
          ),
        );

      expect(v2Categories).toHaveLength(2);
      const v2CategoryIds = v2Categories.map((c) => c.categoryId).sort();
      expect(v2CategoryIds).toEqual([categoryB.id, categoryC.id].sort());

      // 6. v1 카테고리 매핑이 변경되지 않았는지 확인
      const v1CategoriesAfter = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v1.masterId),
            eq(productMasterCategories.version, v1.version),
          ),
        );

      const v1CategoryIdsAfter = v1CategoriesAfter.map((c) => c.categoryId).sort();
      expect(v1CategoryIdsAfter).toEqual([categoryA.id, categoryB.id].sort());
    });
  });

  describe('Scenario 18: v1 태그 [신제품, 할인] → v2 태그 [베스트셀러]', () => {
    it('should maintain independent tag mappings per version', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 태그 그룹 및 태그 값 생성
      const tagGroup = await PimTestFactory.createTagGroup({
        name: 'Product Tags',
      }, db);

      const newProductTag = await PimTestFactory.createTagValue({
        groupId: tagGroup.id,
        name: '신제품',
      }, db);

      const discountTag = await PimTestFactory.createTagValue({
        groupId: tagGroup.id,
        name: '할인',
      }, db);

      const bestsellerTag = await PimTestFactory.createTagValue({
        groupId: tagGroup.id,
        name: '베스트셀러',
      }, db);

      // 2. v1 생성 및 태그 [신제품, 할인] 연결
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      await mastersService.updateVersion(v1.id, {
        tagValueIds: [newProductTag.id, discountTag.id],
      });

      // 3. v1 태그 매핑 확인
      const v1Tags = await db
        .select()
        .from(productTagValues)
        .where(
          and(
            eq(productTagValues.masterId, v1.masterId),
            eq(productTagValues.version, v1.version),
          ),
        );

      expect(v1Tags).toHaveLength(2);
      const v1TagIds = v1Tags.map((t) => t.tagValueId).sort();
      expect(v1TagIds).toEqual([newProductTag.id, discountTag.id].sort());

      // 4. v2 생성 및 태그 [베스트셀러]로 변경
      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);

      await mastersService.updateVersion(v2.id, {
        tagValueIds: [bestsellerTag.id],
      });

      // 5. v2 태그 매핑 확인
      const v2Tags = await db
        .select()
        .from(productTagValues)
        .where(
          and(
            eq(productTagValues.masterId, v2.masterId),
            eq(productTagValues.version, v2.version),
          ),
        );

      expect(v2Tags).toHaveLength(1);
      expect(v2Tags[0].tagValueId).toBe(bestsellerTag.id);

      // 6. v1 태그 매핑이 변경되지 않았는지 확인
      const v1TagsAfter = await db
        .select()
        .from(productTagValues)
        .where(
          and(
            eq(productTagValues.masterId, v1.masterId),
            eq(productTagValues.version, v1.version),
          ),
        );

      const v1TagIdsAfter = v1TagsAfter.map((t) => t.tagValueId).sort();
      expect(v1TagIdsAfter).toEqual([newProductTag.id, discountTag.id].sort());
    });
  });

  describe('Scenario 19: primaryCategoryId 설정 및 변경', () => {
    it('should set and change primary category independently per version', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 카테고리 A, B 생성
      const categoryA = await PimTestFactory.createCategory({
        name: 'Category A',
        slug: 'category-a',
      }, db);
      const categoryB = await PimTestFactory.createCategory({
        name: 'Category B',
        slug: 'category-b',
      }, db);

      // 2. v1 생성 및 카테고리 A를 primary로 설정
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      await mastersService.updateVersion(v1.id, {
        categoryIds: [categoryA.id, categoryB.id],
        primaryCategoryId: categoryA.id,
      });

      // 3. v1 primary 카테고리 확인
      const v1PrimaryCategory = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v1.masterId),
            eq(productMasterCategories.version, v1.version),
            eq(productMasterCategories.isPrimary, true),
          ),
        );

      expect(v1PrimaryCategory).toHaveLength(1);
      expect(v1PrimaryCategory[0].categoryId).toBe(categoryA.id);

      // 4. v2 생성 및 카테고리 B를 primary로 변경
      const v2 = await versionsService.createDraftVersion(v1.id, 'user-123', true);

      await mastersService.updateVersion(v2.id, {
        categoryIds: [categoryA.id, categoryB.id],
        primaryCategoryId: categoryB.id,
      });

      // 5. v2 primary 카테고리 확인
      const v2PrimaryCategory = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v2.masterId),
            eq(productMasterCategories.version, v2.version),
            eq(productMasterCategories.isPrimary, true),
          ),
        );

      expect(v2PrimaryCategory).toHaveLength(1);
      expect(v2PrimaryCategory[0].categoryId).toBe(categoryB.id);

      // 6. v1 primary 카테고리가 변경되지 않았는지 확인
      const v1PrimaryCategoryAfter = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v1.masterId),
            eq(productMasterCategories.version, v1.version),
            eq(productMasterCategories.isPrimary, true),
          ),
        );

      expect(v1PrimaryCategoryAfter).toHaveLength(1);
      expect(v1PrimaryCategoryAfter[0].categoryId).toBe(categoryA.id);
    });

    it('should handle case where no primary category is set', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 카테고리 A, B 생성
      const categoryA = await PimTestFactory.createCategory({
        name: 'Category A',
        slug: 'category-a',
      }, db);
      const categoryB = await PimTestFactory.createCategory({
        name: 'Category B',
        slug: 'category-b',
      }, db);

      // 2. v1 생성 (primary 없음)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      await mastersService.updateVersion(v1.id, {
        categoryIds: [categoryA.id, categoryB.id],
      });

      // 3. primary 카테고리가 없는지 확인
      const v1PrimaryCategories = await db
        .select()
        .from(productMasterCategories)
        .where(
          and(
            eq(productMasterCategories.masterId, v1.masterId),
            eq(productMasterCategories.version, v1.version),
            eq(productMasterCategories.isPrimary, true),
          ),
        );

      expect(v1PrimaryCategories).toHaveLength(0);
    });
  });
});

