import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterPricingRules, pricingRules } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('PricingService - Version Management Tests', () => {
  let service: PricingService;
  let validatorService: PricingValidatorService;
  let calculatorService: PricingCalculatorService;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        PricingService,
        PricingValidatorService,
        PricingCalculatorService,
        {
          provide: DbService,
          useFactory: () => ({
            db: PimTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<PricingService>(PricingService);
    validatorService = module.get<PricingValidatorService>(
      PricingValidatorService,
    );
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

  describe('5.1 가격 정책 설정', () => {
    it('✅ base_price 규칙 설정', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      const result = await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      expect(result.basePriceRules).toHaveLength(1);
      expect(result.basePriceRules[0].operationValue).toBe(10000);
    });

    it('✅ membership_price 규칙 설정', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 먼저 base_price 설정
      await service.replaceMasterRules(
        master.masterId,
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
          tieredPriceRules: [],
        },
        master.version,
      );

      const retrieved = await service.getMasterRules(
        master.masterId,
        master.version,
      );

      expect(retrieved.membershipPriceRules).toHaveLength(1);
      expect(retrieved.membershipPriceRules[0].operationValue).toBe(-100);
    });

    it('✅ tiered_price 규칙 설정 (minQuantity 포함)', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.replaceMasterRules(
        master.masterId,
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
          tieredPriceRules: [
            {
              layer: 'tiered_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -50, // 5% 할인
              minQuantity: 10,
            },
            {
              layer: 'tiered_price',
              order: 2,
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -100, // 10% 할인
              minQuantity: 50,
            },
          ],
        },
        master.version,
      );

      const retrieved = await service.getMasterRules(
        master.masterId,
        master.version,
      );

      expect(retrieved.tieredPriceRules).toHaveLength(2);
      expect(retrieved.tieredPriceRules[0].minQuantity).toBe(10);
      expect(retrieved.tieredPriceRules[1].minQuantity).toBe(50);
    });

    it('✅ 전체 레이어 한번에 설정', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      const result = await service.replaceMasterRules(
        master.masterId,
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
              operationValue: -100,
            },
          ],
          tieredPriceRules: [
            {
              layer: 'tiered_price',
              order: 1,
              scopeType: 'all_variants',
              operationType: 'scale',
              operationValue: -50,
              minQuantity: 10,
            },
          ],
        },
        master.version,
      );

      expect(result.basePriceRules).toHaveLength(1);
      expect(result.membershipPriceRules).toHaveLength(1);
      expect(result.tieredPriceRules).toHaveLength(1);
    });

    it('✅ 매핑 테이블 연결 확인', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      // 매핑 테이블 확인
      const mappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, master.masterId),
            eq(productMasterPricingRules.version, master.version),
          ),
        );

      expect(mappings).toHaveLength(1);
    });
  });

  describe('5.2 버전별 가격 정책', () => {
    it('✅ Active 버전 가격 정책 조회 (version 파라미터 없음)', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 가격 정책 설정
      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      // Publish to active
      await PimTestFactory.publishVersion(master.id, 'active');

      // version 파라미터 없이 조회 (active 버전 자동 조회)
      const retrieved = await service.getMasterRules(master.masterId);

      expect(retrieved.basePriceRules).toHaveLength(1);
    });

    it('✅ 특정 버전 가격 정책 조회 (version 지정)', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1 가격 정책
      await PimTestFactory.createBasePriceRules(
        v1.masterId,
        v1.version,
        10000,
        db,
      );

      // v2 생성 및 다른 가격 정책
      const v2 = await PimTestFactory.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await PimTestFactory.createBasePriceRules(
        v2.masterId,
        v2.version,
        15000,
        db,
      );

      // v1 조회
      const v1Rules = await service.getMasterRules(v1.masterId, v1.version);
      expect(v1Rules.basePriceRules[0].operationValue).toBe(10000);

      // v2 조회
      const v2Rules = await service.getMasterRules(v2.masterId, v2.version);
      expect(v2Rules.basePriceRules[0].operationValue).toBe(15000);
    });

    it('✅ Draft 버전에서 가격 정책 수정', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Draft 버전에 가격 정책 설정
      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      const retrieved = await service.getMasterRules(
        master.masterId,
        master.version,
      );

      expect(retrieved.basePriceRules[0].operationValue).toBe(10000);
    });

    it('❌ Active 버전 가격 정책 수정 불가', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Publish to active
      await PimTestFactory.publishVersion(master.id, 'active');

      // Active 버전 가격 정책 수정 시도
      await expect(
        service.replaceMasterRules(
          master.masterId,
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
          master.version,
        ),
      ).rejects.toThrow(/cannot.*modify.*active/i);
    });

    it('❌ Inactive 버전 가격 정책 수정 불가', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Publish to inactive
      await PimTestFactory.publishVersion(master.id, 'inactive');

      // Inactive 버전 가격 정책 수정 시도
      await expect(
        service.replaceMasterRules(
          master.masterId,
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
          master.version,
        ),
      ).rejects.toThrow(/cannot.*modify.*inactive/i);
    });
  });

  describe('5.3 가격 정책 재사용', () => {
    it('✅ 여러 버전이 동일 pricing rule 참조', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1 가격 정책
      const rules = await PimTestFactory.createBasePriceRules(
        v1.masterId,
        v1.version,
        10000,
        db,
      );
      const rule1Id = rules[0].id;

      // v2 생성 (매핑 복사)
      const v2 = await PimTestFactory.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // v2도 동일한 rule 참조
      const v2Mappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
            eq(productMasterPricingRules.pricingRuleId, rule1Id),
          ),
        );

      expect(v2Mappings).toHaveLength(1);
    });

    it('✅ 한 버전에서 규칙 변경 시 다른 버전 영향 없음', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1 가격 정책
      await PimTestFactory.createBasePriceRules(
        v1.masterId,
        v1.version,
        10000,
        db,
      );

      // v2 생성 및 다른 가격 정책
      const v2 = await PimTestFactory.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await service.replaceMasterRules(
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

      // v1 가격 정책 확인 (변경되지 않음)
      const v1Rules = await service.getMasterRules(v1.masterId, v1.version);
      expect(v1Rules.basePriceRules[0].operationValue).toBe(10000);

      // v2 가격 정책 확인
      const v2Rules = await service.getMasterRules(v2.masterId, v2.version);
      expect(v2Rules.basePriceRules[0].operationValue).toBe(15000);
    });

    it('✅ 매핑 독립성 확인', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1 가격 정책
      const v1Rules = await PimTestFactory.createBasePriceRules(
        v1.masterId,
        v1.version,
        10000,
        db,
      );

      // v2 생성 및 매핑 복사
      const v2 = await PimTestFactory.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // v1 매핑 확인
      const v1Mappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v1.masterId),
            eq(productMasterPricingRules.version, v1.version),
          ),
        );

      // v2 매핑 확인
      const v2Mappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, v2.masterId),
            eq(productMasterPricingRules.version, v2.version),
          ),
        );

      // 독립적인 매핑 레코드
      expect(v1Mappings[0].id).not.toBe(v2Mappings[0].id);
      // 같은 pricing rule 참조
      expect(v1Mappings[0].pricingRuleId).toBe(v2Mappings[0].pricingRuleId);
    });
  });

  describe('5.4 고아 규칙 정리', () => {
    it('✅ replaceMasterRules 시 사용하지 않는 규칙 자동 삭제', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 첫 번째 가격 정책
      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      const firstRules = await db.select().from(pricingRules);
      const firstRuleId = firstRules[0].id;

      // 가격 정책 교체
      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      // 첫 번째 규칙이 삭제되었는지 확인
      const remainingRules = await db
        .select()
        .from(pricingRules)
        .where(eq(pricingRules.id, firstRuleId));

      expect(remainingRules).toHaveLength(0);
    });

    it('✅ 다른 버전이 사용 중인 규칙은 유지', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1 가격 정책
      const v1Rules = await PimTestFactory.createBasePriceRules(
        v1.masterId,
        v1.version,
        10000,
        db,
      );
      const sharedRuleId = v1Rules[0].id;

      // v2 생성 (매핑 복사 - 동일 rule 참조)
      const v2 = await PimTestFactory.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // v2 가격 정책 교체
      await service.replaceMasterRules(
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

      // v1이 여전히 사용 중인 규칙은 삭제되지 않음
      const sharedRule = await db
        .select()
        .from(pricingRules)
        .where(eq(pricingRules.id, sharedRuleId));

      expect(sharedRule).toHaveLength(1);
    });

    it('✅ deleteMasterRules 시 고아 정리', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 가격 정책 설정
      await service.replaceMasterRules(
        master.masterId,
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
        master.version,
      );

      const rulesBefore = await db.select().from(pricingRules);
      expect(rulesBefore).toHaveLength(1);

      // 가격 정책 삭제
      await service.deleteMasterRules(master.masterId, master.version);

      // 고아 규칙 삭제 확인
      const rulesAfter = await db.select().from(pricingRules);
      expect(rulesAfter).toHaveLength(0);
    });
  });
});



