import { Test, TestingModule } from '@nestjs/testing';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';

describe('PricingCalculatorService - Price Calculation Tests', () => {
  let service: PricingCalculatorService;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        PricingCalculatorService,
        {
          provide: DbService,
          useFactory: () => ({
            db: PimTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<PricingCalculatorService>(PricingCalculatorService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('6.1 기본 가격 계산', () => {
    it('✅ 0원에서 시작 확인', async () => {
      const master = await PimTestFactory.createProductWithSimplePricing(0);

      const db = PimTestDatabase.getDb();
      const variants = await PimTestFactory.getVersionTree(master.masterId, db);

      // 가격 규칙 없이 계산하면 0원부터 시작
      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variants[0].id,
      );

      expect(result.priceBreakdown.initialPrice).toBe(0);
    });

    it('✅ base_price 레이어만 적용', async () => {
      const master = await PimTestFactory.createProductWithSimplePricing(10000);

      const db = PimTestDatabase.getDb();
      
      // Get the default variant
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const variantId = variantMappings[0].variantId;

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
      );

      expect(result.price).toBe(10000);
      expect(result.priceBreakdown.afterBasePrice).toBe(10000);
    });

    it('✅ 최종 가격 반환', async () => {
      const master = await PimTestFactory.createProductWithSimplePricing(15000);

      const db = PimTestDatabase.getDb();
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const variantId = variantMappings[0].variantId;

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
      );

      expect(result.price).toBe(15000);
      expect(result.variantId).toBe(variantId);
    });

    it('✅ appliedRules 추적 확인', async () => {
      const master = await PimTestFactory.createProductWithSimplePricing(10000);

      const db = PimTestDatabase.getDb();
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const variantId = variantMappings[0].variantId;

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
      );

      expect(result.appliedRules).toBeDefined();
      expect(result.appliedRules.length).toBeGreaterThan(0);
      expect(result.appliedRules[0].layer).toBe('base_price');
    });
  });

  describe('6.2 3단계 레이어 적용', () => {
    it('✅ Layer 1 (base_price) 적용', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await PimTestFactory.createCompletePricingPolicy(
        master.masterId,
        master.version,
        {
          basePrice: 10000,
        },
        db,
      );

      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variantMappings[0].variantId,
      );

      expect(result.priceBreakdown.afterBasePrice).toBe(10000);
    });

    it('✅ Layer 2 (membership_price) 조건부 적용', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await PimTestFactory.createCompletePricingPolicy(
        master.masterId,
        master.version,
        {
          basePrice: 10000,
          membershipDiscount: 10, // 10% 할인
        },
        db,
      );

      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const variantId = variantMappings[0].variantId;

      // 일반 고객
      const regularResult = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
        undefined,
        'regular',
      );

      expect(regularResult.price).toBe(10000);
      expect(regularResult.priceBreakdown.afterMembershipPrice).toBeUndefined();

      // 멤버십 고객
      const membershipResult = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
        undefined,
        'membership',
      );

      expect(membershipResult.price).toBe(9000); // 10% 할인
      expect(membershipResult.priceBreakdown.afterMembershipPrice).toBe(9000);
    });

    it('✅ Layer 3 (tiered_price) 수량별 적용', async () => {
      const master = await PimTestFactory.createProductWithTieredPricing({
        basePrice: 10000,
        tiers: [
          { minQuantity: 10, discountPercentage: 5 },
          { minQuantity: 50, discountPercentage: 10 },
        ],
      });

      const db = PimTestDatabase.getDb();
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const variantId = variantMappings[0].variantId;

      // 1개
      const result1 = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
        1,
      );
      expect(result1.price).toBe(10000);

      // 10개 이상
      const result10 = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
        10,
      );
      expect(result10.price).toBe(9500); // 5% 할인

      // 50개 이상
      const result50 = await service.calculateVariantPriceByVersion(
        master.id,
        variantId,
        50,
      );
      expect(result50.price).toBe(9000); // 10% 할인
    });

    it('✅ priceBreakdown 확인 (각 레이어 후 가격)', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await PimTestFactory.createCompletePricingPolicy(
        master.masterId,
        master.version,
        {
          basePrice: 10000,
          membershipDiscount: 10,
        },
        db,
      );

      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        variantMappings[0].variantId,
        undefined,
        'membership',
      );

      expect(result.priceBreakdown.initialPrice).toBe(0);
      expect(result.priceBreakdown.afterBasePrice).toBe(10000);
      expect(result.priceBreakdown.afterMembershipPrice).toBe(9000);
    });
  });

  describe('6.3 Scope 매칭', () => {
    it('✅ scopeType: all_variants - 모든 variant 적용', async () => {
      const db = PimTestDatabase.getDb();
      const master = await PimTestFactory.createCompleteProductWithVersions(
        {
          name: 'Scope 테스트',
          options: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }, { displayName: '파랑' }],
            },
          ],
          basePrice: 10000,
        },
        db,
      );

      // 모든 variants 가격 동일
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      for (const mapping of variantMappings) {
        const result = await service.calculateVariantPriceByVersion(
          master.id,
          mapping.variantId,
        );
        expect(result.price).toBe(10000);
      }
    });

    it('✅ scopeType: with_option - 특정 옵션값 가진 variant만', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 옵션 그룹 생성
      const colorGroup = await PimTestFactory.createOptionGroup(db);
      await PimTestFactory.linkOptionGroupToMaster(
        master.masterId,
        colorGroup.id,
        master.version,
        db,
      );
      await PimTestFactory.createOptionGroupDisplay(
        colorGroup.id,
        master.masterId,
        master.version,
        { displayName: '색상' },
        db,
      );

      // 옵션 값 생성
      const redValue = await PimTestFactory.createOptionValue(colorGroup.id, db);
      await PimTestFactory.createOptionValueDisplay(
        redValue.id,
        master.masterId,
        master.version,
        { displayName: '빨강' },
        db,
      );

      const blueValue = await PimTestFactory.createOptionValue(colorGroup.id, db);
      await PimTestFactory.createOptionValueDisplay(
        blueValue.id,
        master.masterId,
        master.version,
        { displayName: '파랑' },
        db,
      );

      // Variants 생성
      await PimTestFactory.generateAllVariantCombinations(
        master.masterId,
        master.version,
        [{ groupId: colorGroup.id, valueIds: [redValue.id, blueValue.id] }],
        db,
      );

      // 기본 가격 (모든 variant)
      const baseRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 10000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        baseRule.id,
        master.version,
        db,
      );

      // 빨강 옵션만 +5000원
      const redOptionRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'with_option',
          scopeTargetIds: [redValue.id],
          operationType: 'offset',
          operationValue: 5000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        redOptionRule.id,
        master.version,
        db,
      );

      // 가격 확인
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      for (const mapping of variantMappings) {
        // Variant의 옵션 값 확인
        const optionValues = await db.query.variantOptionValues.findMany({
          where: (t, { eq }) => eq(t.variantId, mapping.variantId),
        });

        const hasRed = optionValues.some((ov) => ov.optionValueId === redValue.id);

        const result = await service.calculateVariantPriceByVersion(
          master.id,
          mapping.variantId,
        );

        if (hasRed) {
          expect(result.price).toBe(15000); // 10000 + 5000
        } else {
          expect(result.price).toBe(10000);
        }
      }
    });

    it('✅ scopeType: variants - 특정 variant ID만', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // 기본 가격
      const baseRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 10000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        baseRule.id,
        master.version,
        db,
      );

      // 특정 variant만 +5000원
      const specificRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'variants',
          scopeTargetIds: [defaultVariant.id],
          operationType: 'offset',
          operationValue: 5000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        specificRule.id,
        master.version,
        db,
      );

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        defaultVariant.id,
      );

      expect(result.price).toBe(15000); // 10000 + 5000
    });
  });

  describe('6.4 연산 타입', () => {
    it('✅ operationType: override - 고정 가격', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      const rule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 25000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        rule.id,
        master.version,
        db,
      );

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        defaultVariant.id,
      );

      expect(result.price).toBe(25000);
    });

    it('✅ operationType: offset - 더하기/빼기', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // 기본 가격
      const baseRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 10000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        baseRule.id,
        master.version,
        db,
      );

      // +3000원
      const offsetRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'all_variants',
          operationType: 'offset',
          operationValue: 3000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        offsetRule.id,
        master.version,
        db,
      );

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        defaultVariant.id,
      );

      expect(result.price).toBe(13000); // 10000 + 3000
    });

    it('✅ operationType: scale - 비율 적용', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // 기본 가격
      const baseRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 10000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        baseRule.id,
        master.version,
        db,
      );

      // 20% 증가 (scale: +200)
      const scaleRule = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'all_variants',
          operationType: 'scale',
          operationValue: 200, // 20% = 200/1000
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        scaleRule.id,
        master.version,
        db,
      );

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        defaultVariant.id,
      );

      expect(result.price).toBe(12000); // 10000 * 1.2
    });

    it('✅ 여러 규칙 순차 적용 확인', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // Rule 1: 기본 가격
      const rule1 = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 1,
          scopeType: 'all_variants',
          operationType: 'override',
          operationValue: 10000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        rule1.id,
        master.version,
        db,
      );

      // Rule 2: +2000원
      const rule2 = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'all_variants',
          operationType: 'offset',
          operationValue: 2000,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        rule2.id,
        master.version,
        db,
      );

      // Rule 3: 10% 할인
      const rule3 = await PimTestFactory.createPricingRule(
        {
          layer: 'base_price',
          order: 3,
          scopeType: 'all_variants',
          operationType: 'scale',
          operationValue: -100,
        },
        db,
      );
      await PimTestFactory.linkPricingRuleToMaster(
        master.masterId,
        rule3.id,
        master.version,
        db,
      );

      const result = await service.calculateVariantPriceByVersion(
        master.id,
        defaultVariant.id,
      );

      // 10000 → 12000 (+ 2000) → 10800 (-10%)
      expect(result.price).toBe(10800);
      expect(result.appliedRules).toHaveLength(3);
    });
  });

  describe('6.6 Variant 가격 세트 계산', () => {
    it('✅ calculateVariantPriceSet() - 가격 세트 반환', async () => {
      const db = PimTestDatabase.getDb();
      const master = await PimTestFactory.createCompleteProductWithVersions(
        {
          options: [
            {
              displayName: '사이즈',
              values: [{ displayName: 'S' }, { displayName: 'M' }],
            },
          ],
          basePrice: 10000,
        },
        db,
      );

      // Get a variant from the master
      const variantMappings = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) => and(
          eq(t.masterId, master.masterId),
          eq(t.version, master.version),
        ),
      });

      expect(variantMappings.length).toBeGreaterThan(0);

      const priceSet = await service.calculateVariantPriceSet(
        master.id,
        variantMappings[0].variantId,
      );

      expect(priceSet.basePrice).toBe(10000);
      expect(priceSet.membershipPrice).toBe(10000);
      expect(priceSet.tieredPrices).toEqual([]);
    });

    it('✅ 일반가와 멤버십가 모두 계산', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await PimTestFactory.createCompletePricingPolicy(
        master.masterId,
        master.version,
        {
          basePrice: 10000,
          membershipDiscount: 10,
        },
        db,
      );

      const priceSet = await service.calculateVariantPriceSet(
        master.id,
        defaultVariant.id,
      );

      expect(priceSet.basePrice).toBe(10000);
      expect(priceSet.membershipPrice).toBe(9000);
      expect(priceSet.tieredPrices).toEqual([]);
    });
  });
});



