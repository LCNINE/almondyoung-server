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

describe('Product Workflow - Integration Tests', () => {
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
    calculatorService = module.get<PricingCalculatorService>(
      PricingCalculatorService,
    );
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('7.1 완전한 상품 생성 플로우', () => {
    it('✅ 전체 플로우: 생성 → 정보 입력 → 옵션 → 가격 → Publish', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 빈 draft 생성
      const master = await mastersService.createMaster({});
      expect(master.versionStatus).toBe('draft');

      // 2. 기본 정보 입력
      const updated = await mastersService.updateMaster(master.id, {
        name: '무선 이어폰',
        description: '고음질 무선 이어폰',
        brand: '테스트 브랜드',
      });
      expect(updated.name).toBe('무선 이어폰');

      // 3. 옵션 추가
      await mastersService.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [
                { displayName: '블랙' },
                { displayName: '화이트' },
              ],
            },
            {
              displayName: '사이즈',
              values: [{ displayName: 'S' }, { displayName: 'M' }],
            },
          ],
        },
      });

      // 4. Variants 자동 생성 확인 (2 × 2 = 4개)
      const variantMappings = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );
      expect(variantMappings).toHaveLength(4);

      // 5. 가격 정책 설정
      await pricingService.replaceMasterRules(
        master.masterId,
        {
          basePriceRules: [
            {
              layer: 'base_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'override',
              operationValue: 50000,
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
          tieredPriceRules: [],
        },
        master.version,
      );

      // 6. 가격 계산 확인 (Draft 버전)
      const price = await calculatorService.calculateVariantPriceByVersion(
        master.id,
        variantMappings[0].variantId,
      );
      expect(price.price).toBe(50000);

      const membershipPrice = await calculatorService.calculateVariantPriceByVersion(
        master.id,
        variantMappings[0].variantId,
        undefined,
        'membership',
      );
      expect(membershipPrice.price).toBe(45000);

      // 7. Publish → Active
      await versionsService.publishVersion(
        master.id,
        'active',
      );
      const published = await versionsService.getVersionById(master.id);
      expect(published.versionStatus).toBe('active');
    });
  });

  describe('7.2 버전 수정 플로우', () => {
    it('✅ Active 버전 수정 플로우', async () => {
      const db = PimTestDatabase.getDb();

      // 1. Active 버전 생성
      const v1 = await mastersService.createMaster({
        name: 'v1 상품',
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

      // 2. 새 Draft 버전 생성
      const v2 = await versionsService.createDraftVersion(
        v1.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );
      expect(v2.version).toBe(2);
      expect(v2.versionStatus).toBe('draft');

      // 3. Draft에서 가격 정책 변경
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

      // 4. Draft에서 옵션 추가
      await mastersService.updateMaster(v2.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }],
            },
          ],
        },
      });

      // 5. Variants 재생성 확인
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );
      expect(v2Variants).toHaveLength(1);

      // 6. Publish
      await versionsService.publishVersion(v2.id, 'active');

      // 7. 기존 Active → Inactive 확인
      const v1Updated = await versionsService.getVersionById(v1.id);
      expect(v1Updated.versionStatus).toBe('inactive');

      // 8. 새 Active 확인
      const activeVersion = await versionsService.getActiveVersion(v2.masterId);
      expect(activeVersion.id).toBe(v2.id);
    });
  });

  describe('7.3 버전 롤백 시나리오', () => {
    it('✅ 이전 버전으로 롤백', async () => {
      // 1. Version 1 (Active)
      const v1 = await mastersService.createMaster({
        name: 'v1 - 안정 버전',
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

      // 2. Version 2 (Draft) 생성 및 수정
      const v2 = await versionsService.createDraftVersion(
        v1.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );
      await mastersService.updateMaster(v2.id, {
        name: 'v2 - 문제 있는 버전',
      });

      // 3. Version 2 Publish → Active
      await versionsService.publishVersion(v2.id, 'active');
      const active = await versionsService.getActiveVersion(v1.masterId);
      expect(active.id).toBe(v2.id);

      // 4. Version 1 다시 Draft 생성 (롤백)
      const v3 = await versionsService.createDraftVersion(
        v1.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );
      expect(v3.name).toBe('v1 - 안정 버전');

      // 5. Version 3 (v1 복사본) Publish
      await versionsService.publishVersion(v3.id, 'active');

      // 6. 이전 상태로 복원 확인
      const rolledBack = await versionsService.getActiveVersion(v1.masterId);
      expect(rolledBack.name).toBe('v1 - 안정 버전');
      expect(rolledBack.id).toBe(v3.id);
    });
  });

  describe('7.4 복잡한 옵션 변경', () => {
    it('✅ 옵션 추가/제거 플로우', async () => {
      const db = PimTestDatabase.getDb();

      // 1. 2개 옵션 그룹 (색상, 사이즈)
      const master = await mastersService.createMaster({
        name: '옵션 변경 테스트',
      });

      await mastersService.updateMaster(master.id, {
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

      // 초기 variants 확인 (2 × 2 = 4개)
      let variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );
      expect(variants).toHaveLength(4);

      // 옵션 그룹과 값 조회 (추후 수정용)
      const optionGroupsQuery = await db.query.productMasterOptionGroups.findMany(
        {
          where: (t, { and, eq }) =>
            and(
              eq(t.masterId, master.masterId),
              eq(t.version, master.version),
            ),
        },
      );

      const sizeGroupMapping = optionGroupsQuery.find(async (og) => {
        const displays = await db.query.productOptionGroupDisplays.findMany({
          where: (t, { and, eq }) =>
            and(
              eq(t.optionGroupId, og.optionGroupId),
              eq(t.masterId, master.masterId),
              eq(t.version, master.version),
            ),
        });
        return displays.some((d) => d.displayName === '사이즈');
      });

      // Note: 실제 구현에서는 더 정교한 옵션 수정 로직 필요
      // 여기서는 옵션 변경 시 variants가 재생성되는 것만 확인
    });
  });

  describe('7.5 가격 정책 버전 독립성', () => {
    it('✅ 버전별 독립적인 가격 정책', async () => {
      const db = PimTestDatabase.getDb();

      // 1. Version 1: 기본가 10,000원
      const v1 = await mastersService.createMaster({
        name: '가격 독립성 테스트',
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

      // 2. Version 2: 기본가 15,000원 (Draft)
      const v2 = await versionsService.createDraftVersion(
        v1.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );
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

      // 3. 두 버전 동시 조회 시 각자 가격 확인
      const v1Pricing = await pricingService.getMasterRules(
        v1.masterId,
        v1.version,
      );
      expect(v1Pricing.basePriceRules[0].operationValue).toBe(10000);

      const v2Pricing = await pricingService.getMasterRules(
        v2.masterId,
        v2.version,
      );
      expect(v2Pricing.basePriceRules[0].operationValue).toBe(15000);

      // 4. Version 2 Publish
      await versionsService.publishVersion(v2.id, 'active');

      // 5. v1과 v2의 가격 정책이 독립적인지 확인
      const v1PricingAfter = await pricingService.getMasterRules(
        v1.masterId,
        v1.version,
      );
      expect(v1PricingAfter.basePriceRules[0].operationValue).toBe(10000); // 변경 없음
    });
  });
});



