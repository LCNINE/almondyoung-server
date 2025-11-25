import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVariants, productMasterOptionGroups, productOptionGroupDisplays, productOptionValueDisplays } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Options Management - Integration Tests', () => {
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

  describe('Scenario 9: v1 옵션 없음 → v2 색상/사이즈 옵션 추가', () => {
    it('should add color and size options and generate 4 variants (2x2)', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (옵션 없음, default variant 1개)
      const v1 = await mastersService.createMaster({
        name: 'Product without options',
      });

      const v1Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(v1Variants).toHaveLength(1); // default variant

      // 2. v2 생성 및 옵션 추가
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
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

      // 3. v2 variants 확인 (2 × 2 = 4개)
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants).toHaveLength(4);

      // 4. 옵션 그룹 2개 확인
      const v2OptionGroups = await db
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, v2.masterId),
            eq(productMasterOptionGroups.version, v2.version),
          ),
        );

      expect(v2OptionGroups).toHaveLength(2);
    });
  });

  describe('Scenario 10: 색상에 "노랑" 추가 (addValues)', () => {
    it('should add yellow to color options and increase variants from 4 to 6', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v2 생성 (색상 2개, 사이즈 2개 = 4 variants)
      const v1 = await mastersService.createMaster({ name: 'Product' });
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
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

      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants).toHaveLength(4);

      // 2. 색상 옵션 그룹 ID 찾기
      const colorGroup = await db.query.productMasterOptionGroups.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v2.masterId),
            eq(t.version, v2.version),
          ),
      });

      const colorDisplay = await db.query.productOptionGroupDisplays.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.optionGroupId, colorGroup!.optionGroupId),
            eq(t.masterId, v2.masterId),
            eq(t.version, v2.version),
            eq(t.displayName, '색상'),
          ),
      });

      expect(colorDisplay).toBeDefined();

      // 3. v3 생성 및 색상에 "노랑" 추가
      const v3 = await versionsService.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v3.id, {
        optionDiff: {
          addValues: [
            {
              optionGroupId: colorGroup!.optionGroupId,
              values: [{ displayName: '노랑' }],
            },
          ],
        },
      });

      // 4. v3 variants 확인 (3 × 2 = 6개)
      const v3Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v3.masterId),
            eq(productMasterVariants.version, v3.version),
          ),
        );

      expect(v3Variants).toHaveLength(6);
    });
  });

  describe('Scenario 11: 사이즈 옵션 그룹 제거 (remove)', () => {
    it('should remove size option group and reduce variants from 6 to 3', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v3 생성 (색상 3개, 사이즈 2개 = 6 variants)
      const v1 = await mastersService.createMaster({ name: 'Product' });
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [
                { displayName: '빨강' },
                { displayName: '파랑' },
                { displayName: '노랑' },
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

      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants).toHaveLength(6);

      // 2. 사이즈 옵션 그룹 ID 찾기
      const optionGroups = await db.query.productMasterOptionGroups.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v2.masterId),
            eq(t.version, v2.version),
          ),
      });

      const sizeGroup = await (async () => {
        for (const og of optionGroups) {
          const display = await db.query.productOptionGroupDisplays.findFirst({
            where: (t, { and, eq }) =>
              and(
                eq(t.optionGroupId, og.optionGroupId),
                eq(t.masterId, v2.masterId),
                eq(t.version, v2.version),
                eq(t.displayName, '사이즈'),
              ),
          });
          if (display) return og;
        }
        return null;
      })();

      expect(sizeGroup).toBeDefined();

      // 3. v3 생성 및 사이즈 옵션 그룹 제거
      const v3 = await versionsService.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v3.id, {
        optionDiff: {
          remove: [sizeGroup!.optionGroupId],
        },
      });

      // 4. v3 variants 확인 (3개만)
      const v3Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v3.masterId),
            eq(productMasterVariants.version, v3.version),
          ),
        );

      expect(v3Variants).toHaveLength(3);

      // 5. v3 옵션 그룹 확인 (1개만 - 색상)
      const v3OptionGroups = await db
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, v3.masterId),
            eq(productMasterOptionGroups.version, v3.version),
          ),
        );

      expect(v3OptionGroups).toHaveLength(1);
    });
  });

  describe('Scenario 12: 옵션 표시명만 변경 (modifyDisplay)', () => {
    it('should modify display name without regenerating variants', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (색상 옵션)
      const v1 = await mastersService.createMaster({ name: 'Product' });

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
          ],
        },
      });

      const v1Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      const initialVariantCount = v1Variants.length;
      expect(initialVariantCount).toBe(2);

      // 2. 옵션 그룹 ID 찾기
      const optionGroup = await db.query.productMasterOptionGroups.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v1.masterId),
            eq(t.version, v1.version),
          ),
      });

      // 3. v2 생성 및 표시명만 변경
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
        optionDiff: {
          modifyDisplay: [
            {
              optionGroupId: optionGroup!.optionGroupId,
              displayName: '컬러', // 색상 → 컬러
            },
          ],
        },
      });

      // 4. v2 variants 개수 확인 (변경 없어야 함)
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants).toHaveLength(initialVariantCount); // 동일

      // 5. 표시명 변경 확인
      const updatedDisplay = await db
        .select()
        .from(productOptionGroupDisplays)
        .where(
          and(
            eq(productOptionGroupDisplays.optionGroupId, optionGroup!.optionGroupId),
            eq(productOptionGroupDisplays.masterId, v2.masterId),
            eq(productOptionGroupDisplays.version, v2.version),
          ),
        );

      expect(updatedDisplay[0].displayName).toBe('컬러');
    });
  });

  describe('Scenario 13: 옵션 값 제거 후 publish (removeValues)', () => {
    it('should remove option values and cleanup corresponding variants', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (색상 3개)
      const v1 = await mastersService.createMaster({ name: 'Product' });

      await mastersService.updateVersion(v1.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [
                { displayName: '빨강' },
                { displayName: '파랑' },
                { displayName: '노랑' },
              ],
            },
          ],
        },
      });

      const v1Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(v1Variants).toHaveLength(3);

      // 2. 옵션 그룹 및 값 찾기
      const optionGroup = await db.query.productMasterOptionGroups.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v1.masterId),
            eq(t.version, v1.version),
          ),
      });

      const yellowValue = await db.query.productOptionValueDisplays.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v1.masterId),
            eq(t.version, v1.version),
            eq(t.displayName, '노랑'),
          ),
      });

      expect(yellowValue).toBeDefined();

      // 3. v2 생성 및 "노랑" 제거
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
        optionDiff: {
          removeValues: [
            {
              optionGroupId: optionGroup!.optionGroupId,
              optionValueIds: [yellowValue!.optionValueId],
            },
          ],
        },
      });

      // 4. v2 variants 확인 (2개로 감소)
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants).toHaveLength(2);

      // 5. v2 publish
      await versionsService.publishVersion(v2.id, 'active');

      // 6. "노랑" 옵션 값이 삭제되었는지 확인
      const yellowAfter = await db
        .select()
        .from(productOptionValueDisplays)
        .where(
          and(
            eq(productOptionValueDisplays.masterId, v2.masterId),
            eq(productOptionValueDisplays.version, v2.version),
            eq(productOptionValueDisplays.displayName, '노랑'),
          ),
        );

      expect(yellowAfter).toHaveLength(0);
    });
  });
});

