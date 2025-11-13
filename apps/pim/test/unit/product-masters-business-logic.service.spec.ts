import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/services/product-masters.service';
import { PricingStrategyFactory } from '../../src/services/pricing/pricing-strategy.factory';
import { OptionBasedPricingStrategy } from '../../src/services/pricing/option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from '../../src/services/pricing/variant-based-pricing.strategy';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { pimSchema } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('ProductMastersService - Business Logic Tests', () => {
  let service: ProductMastersService;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    const mockStreamPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };

    module = await Test.createTestingModule({
      providers: [
        ProductMastersService,
        PricingStrategyFactory,
        OptionBasedPricingStrategy,
        VariantBasedPricingStrategy,
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
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('createOptionGroups()', () => {
    it('✅ 옵션 그룹 및 값 생성', async () => {
      const master = await PimTestFactory.createMaster({
        name: '옵션 테스트 상품',
      });

      const optionGroups = [
        {
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small' },
            { value: 'M', displayName: 'Medium' },
          ]
        }
      ];

      await service.createOptionGroups(master.id, optionGroups);

      // 옵션 그룹 확인
      const groups = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionGroups)
        .where(eq(pimSchema.productOptionGroups.masterId, master.id));

      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('size');

      // 옵션 값 확인
      const values = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionValues)
        .where(eq(pimSchema.productOptionValues.optionGroupId, groups[0].id));

      expect(values).toHaveLength(2);
    });

    it('✅ 정렬 순서 적용', async () => {
      const master = await PimTestFactory.createMaster({
        name: '정렬 테스트 상품',
      });

      const optionGroups = [
        {
          name: 'priority',
          displayName: '우선순위',
          sortOrder: 5,
          values: [
            { value: 'high', displayName: 'High', sortOrder: 10 },
            { value: 'low', displayName: 'Low', sortOrder: 20 },
          ]
        }
      ];

      await service.createOptionGroups(master.id, optionGroups);

      const groups = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionGroups)
        .where(eq(pimSchema.productOptionGroups.masterId, master.id));

      expect(groups[0].sortOrder).toBe(5);

      const values = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionValues)
        .where(eq(pimSchema.productOptionValues.optionGroupId, groups[0].id));

      const highValue = values.find(v => v.value === 'high');
      const lowValue = values.find(v => v.value === 'low');

      expect(highValue!.sortOrder).toBe(10);
      expect(lowValue!.sortOrder).toBe(20);
    });

    it('❌ 중복 옵션 그룹명 시 에러', async () => {
      const master = await PimTestFactory.createMaster({
        name: '중복 옵션 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [{ value: 'S', displayName: 'Small' }]
        }
      ]);

      await expect(
        service.createOptionGroups(master.id, [
          {
            name: 'size',
            displayName: '사이즈 중복',
            values: [{ value: 'M', displayName: 'Medium' }]
          }
        ])
      ).rejects.toThrow(/already exists/i);
    });

    it('❌ 필수 필드 누락 시 에러', async () => {
      const master = await PimTestFactory.createMaster({
        name: '필수 필드 테스트',
      });

      await expect(
        service.createOptionGroups(master.id, [
          {
            name: 'incomplete',
            // displayName 누락
            values: []
          } as any
        ])
      ).rejects.toThrow();
    });
  });

  describe('generateVariants()', () => {
    it('✅ 단일 옵션 그룹으로 variants 자동 생성 (3개 조합)', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Variants 생성 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small' },
            { value: 'M', displayName: 'Medium' },
            { value: 'L', displayName: 'Large' }
          ]
        }
      ]);

      await service.generateVariants(master.id);

      const variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      expect(variants).toHaveLength(3);
    });

    it('✅ 다중 옵션 그룹으로 variants 자동 생성 (3x4 = 12개 조합)', async () => {
      const master = await PimTestFactory.createMaster({
        name: '다중 옵션 Variants 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small' },
            { value: 'M', displayName: 'Medium' },
            { value: 'L', displayName: 'Large' }
          ]
        },
        {
          name: 'color',
          displayName: '색상',
          values: [
            { value: 'red', displayName: 'Red' },
            { value: 'blue', displayName: 'Blue' },
            { value: 'green', displayName: 'Green' },
            { value: 'black', displayName: 'Black' }
          ]
        }
      ]);

      await service.generateVariants(master.id);

      const variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      expect(variants).toHaveLength(12); // 3 x 4 = 12
    });

    it('✅ Variant-OptionValue 매핑 검증', async () => {
      const master = await PimTestFactory.createMaster({
        name: '매핑 검증 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small' },
            { value: 'M', displayName: 'Medium' }
          ]
        }
      ]);

      await service.generateVariants(master.id);

      const variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      // 각 variant가 옵션 값과 연결되어 있는지 확인
      for (const variant of variants) {
        const mappings = await PimTestDatabase.getDb()
          .select()
          .from(pimSchema.variantOptionValues)
          .where(eq(pimSchema.variantOptionValues.variantId, variant.id));

        expect(mappings.length).toBeGreaterThan(0);
      }
    });

    it('❌ 이미 variants가 있는 경우 에러', async () => {
      const master = await PimTestFactory.createMaster({
        name: '중복 Variants 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [{ value: 'S', displayName: 'Small' }]
        }
      ]);

      await service.generateVariants(master.id);

      await expect(
        service.generateVariants(master.id)
      ).rejects.toThrow(/already has variants/i);
    });

    it('❌ 존재하지 않는 Master에 대한 생성 시 에러', async () => {
      await expect(
        service.generateVariants('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('regenerateVariants()', () => {
    it('✅ 기존 variants 삭제 후 재생성', async () => {
      const master = await PimTestFactory.createMaster({
        name: '재생성 테스트',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small' },
            { value: 'M', displayName: 'Medium' }
          ]
        }
      ]);

      await service.generateVariants(master.id);

      let variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      expect(variants).toHaveLength(2);

      // 재생성
      await service.regenerateVariants(master.id);

      variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      expect(variants).toHaveLength(2);
    });

    it('❌ 존재하지 않는 Master에 대한 재생성 시 에러', async () => {
      await expect(
        service.regenerateVariants('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('generateDefaultVariant()', () => {
    it('✅ 옵션 없는 Master에 기본 variant 생성', async () => {
      const master = await PimTestFactory.createMaster({
        name: '기본 Variant 테스트',
      });

      await service.generateDefaultVariant(master.id);

      const variants = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productVariants)
        .where(eq(pimSchema.productVariants.masterId, master.id));

      expect(variants).toHaveLength(1);
      expect(variants[0].isDefault).toBe(true);
      expect(variants[0].status).toBe('active');
    });

    it('❌ 이미 옵션 그룹이 있는 경우 에러', async () => {
      const master = await PimTestFactory.createMaster({
        name: '옵션 있는 Master',
      });

      await service.createOptionGroups(master.id, [
        {
          name: 'size',
          displayName: '사이즈',
          values: [{ value: 'S', displayName: 'Small' }]
        }
      ]);

      await expect(
        service.generateDefaultVariant(master.id)
      ).rejects.toThrow(/with option groups/i);
    });

    it('❌ 이미 variants가 있는 경우 에러', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Variants 있는 Master',
      });

      await service.generateDefaultVariant(master.id);

      await expect(
        service.generateDefaultVariant(master.id)
      ).rejects.toThrow(/already has variants/i);
    });
  });

  describe('getPricePreview()', () => {
    it('✅ option_based 전략: 옵션 가격 합산 미리보기', async () => {
      const master = await PimTestFactory.createMaster({
        name: '가격 미리보기 테스트',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      });

      const sizeGroup = await PimTestFactory.createOptionGroup(master.id, {
        name: 'size',
        displayName: '사이즈',
      });

      const sizeS = await PimTestFactory.createOptionValue(sizeGroup.id, {
        value: 'S',
        displayName: 'Small',
      });

      const sizeM = await PimTestFactory.createOptionValue(sizeGroup.id, {
        value: 'M',
        displayName: 'Medium',
      });

      // 옵션별 가격 설정
      await PimTestFactory.setOptionValuePrice(master.id, sizeS.id, 0);
      await PimTestFactory.setOptionValuePrice(master.id, sizeM.id, 1000);

      // Variants 생성
      const variantS = await PimTestFactory.createVariant(master.id, {
        variantName: 'Small',
      });
      const variantM = await PimTestFactory.createVariant(master.id, {
        variantName: 'Medium',
      });

      await PimTestFactory.linkVariantToOptionValue(variantS.id, sizeS.id);
      await PimTestFactory.linkVariantToOptionValue(variantM.id, sizeM.id);

      const preview = await service.getPricePreview(master.id);

      expect(preview.masterId).toBe(master.id);
      expect(preview.variants).toHaveLength(2);

      const smallVariant = preview.variants.find(v => v.optionCombination.includes('Small'));
      const mediumVariant = preview.variants.find(v => v.optionCombination.includes('Medium'));

      expect(smallVariant!.price).toBe(10000); // basePrice + 0
      expect(mediumVariant!.price).toBe(11000); // basePrice + 1000
    });

    it('❌ 존재하지 않는 Master 조회 시 에러', async () => {
      await expect(
        service.getPricePreview('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/i);
    });

    it('✅ variants가 없는 경우 빈 배열 반환', async () => {
      const master = await PimTestFactory.createMaster({
        name: 'Variants 없는 상품',
      });

      const preview = await service.getPricePreview(master.id);

      expect(preview.masterId).toBe(master.id);
      expect(preview.variants).toHaveLength(0);
    });
  });

  describe('changePricingStrategy()', () => {
    it('✅ option_based → variant_based 전환', async () => {
      const master = await PimTestFactory.createMaster({
        name: '전략 전환 테스트',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      });

      await service.changePricingStrategy(master.id, 'variant_based', {});

      const updated = await service.getMasterById(master.id);
      expect(updated!.pricingStrategy).toBe('variant_based');
    });

    it('❌ 존재하지 않는 Master에 대한 전환 시 에러', async () => {
      await expect(
        service.changePricingStrategy(
          '00000000-0000-0000-0000-000000000000',
          'variant_based',
          {}
        )
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('initializePricingStrategy()', () => {
    it('✅ option_based: optionValuePrices 테이블에 가격 저장', async () => {
      const master = await PimTestFactory.createMaster({
        name: '가격 초기화 테스트',
        pricingStrategy: 'option_based',
      });

      const sizeGroup = await PimTestFactory.createOptionGroup(master.id, {
        name: 'size',
        displayName: '사이즈',
      });

      const sizeS = await PimTestFactory.createOptionValue(sizeGroup.id, {
        value: 'S',
        displayName: 'Small',
      });

      await service.initializePricingStrategy(master.id, {
        pricingStrategy: 'option_based',
        optionGroups: [
          {
            ...sizeGroup,
            values: [
              {
                id: sizeS.id,
                price: 5000,
              }
            ]
          }
        ]
      });

      const prices = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.optionValuePrices)
        .where(eq(pimSchema.optionValuePrices.masterId, master.id));

      expect(prices.length).toBeGreaterThan(0);
    });
  });
});

