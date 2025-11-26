import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVariants, productMasterPricingRules } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Pricing Independence - Integration Tests', () => {
  let mastersService: ProductMastersService;
  let versionsService: ProductVersionsService;
  let pricingService: PricingService;
  let calculatorService: PricingCalculatorService;
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
    calculatorService = module.get<PricingCalculatorService>(PricingCalculatorService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('Scenario 14: v1 10,000원, v2 15,000원 → 동시 존재 시 가격 독립 확인', () => {
    it('should maintain independent pricing for different versions', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 10,000원 설정
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

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

      // 2. v2 생성 및 15,000원 설정
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

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

      // 3. 각 버전의 가격 규칙 독립적으로 조회
      const v1Pricing = await pricingService.getMasterRules(
        v1.masterId,
        v1.version,
      );

      const v2Pricing = await pricingService.getMasterRules(
        v2.masterId,
        v2.version,
      );

      expect(v1Pricing.basePriceRules[0].operationValue).toBe(10000);
      expect(v2Pricing.basePriceRules[0].operationValue).toBe(15000);

      // 4. 각 버전의 variant 가격 계산 확인
      const v1Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      const v1Price = await calculatorService.calculateVariantPriceByVersion(
        v1.id,
        v1Variants[0].variantId,
      );

      const v2Price = await calculatorService.calculateVariantPriceByVersion(
        v2.id,
        v2Variants[0].variantId,
      );

      expect(v1Price.price).toBe(10000);
      expect(v2Price.price).toBe(15000);
    });
  });

  describe('Scenario 15: v2 publish 후에도 v1 가격 규칙 변경 없음', () => {
    it('should keep v1 pricing rules unchanged after v2 publish', async () => {
      // 1. v1 생성, 가격 설정, publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

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

      await versionsService.publishVersion(v1.id, 'active');

      // 2. v1 가격 규칙 백업
      const v1PricingBefore = await pricingService.getMasterRules(
        v1.masterId,
        v1.version,
      );

      // 3. v2 생성, 가격 변경
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await pricingService.replaceMasterRules(
        v2.masterId,
        {
          basePriceRules: [
            {
              layer: 'base_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 20000,
            },
          ],
          membershipPriceRules: [],
          tieredPriceRules: [],
        },
        v2.version,
      );

      // 4. v2 publish
      await versionsService.publishVersion(v2.id, 'active');

      // 5. v1 가격 규칙이 변경되지 않았는지 확인
      const v1PricingAfter = await pricingService.getMasterRules(
        v1.masterId,
        v1.version,
      );

      expect(v1PricingAfter.basePriceRules[0].operationValue).toBe(10000);
      expect(v1PricingBefore.basePriceRules[0].operationValue).toBe(
        v1PricingAfter.basePriceRules[0].operationValue,
      );

      // 6. v2는 20,000원으로 설정되어 있음
      const v2Pricing = await pricingService.getMasterRules(
        v2.masterId,
        v2.version,
      );

      expect(v2Pricing.basePriceRules[0].operationValue).toBe(20000);
    });
  });

  describe('Scenario 16: 가격 규칙 복사 확인 (copyMappings=true)', () => {
    it('should copy pricing rules when creating draft with copyMappings=true', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 가격 규칙 설정
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

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
          membershipPriceRules: [
            {
              layer: 'membership_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100, // 10% 할인
            },
          ],
          tieredPriceRules: [
            {
              layer: 'tiered_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -200, // 20% 할인
              minQuantity: 10,
            },
          ],
        },
        v1.version,
      );

      // 2. v1 가격 규칙 매핑 조회
      const v1PricingRuleMappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v1.masterId),
            eq(productMasterPricingRules.version, v1.version),
          ),
        );

      expect(v1PricingRuleMappings.length).toBe(3); // base + membership + tiered

      // 3. v2 생성 (copyMappings=true)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 4. v2 가격 규칙 매핑 조회 (복사되었는지 확인)
      const v2PricingRuleMappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
          ),
        );

      expect(v2PricingRuleMappings.length).toBe(3);

      // 5. v2 가격 규칙 내용 확인 (v1과 동일)
      const v2Pricing = await pricingService.getMasterRules(
        v2.masterId,
        v2.version,
      );

      expect(v2Pricing.basePriceRules[0].operationValue).toBe(10000);
      expect(v2Pricing.membershipPriceRules[0].operationValue).toBe(-100);
      expect(v2Pricing.tieredPriceRules[0].operationValue).toBe(-200);
      expect(v2Pricing.tieredPriceRules[0].minQuantity).toBe(10);
    });

    it('should not copy pricing rules when copyMappings=false', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 가격 규칙 설정
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

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

      // 2. v2 생성 (copyMappings=false)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', false);

      // 3. v2 가격 규칙 매핑 조회 (없어야 함)
      const v2PricingRuleMappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
          ),
        );

      expect(v2PricingRuleMappings).toHaveLength(0);
    });
  });
});

