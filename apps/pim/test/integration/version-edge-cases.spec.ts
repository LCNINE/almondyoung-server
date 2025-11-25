import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PricingService } from '../../src/core/pricing/pricing.service';
import { PricingCalculatorService } from '../../src/core/pricing/pricing-calculator.service';
import { PricingValidatorService } from '../../src/core/pricing/pricing-validator.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasterVersions, productMasterVariants, productVariants } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('Version Edge Cases - Integration Tests', () => {
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

  describe('Scenario 24: draft 버전에서만 수정 가능 검증', () => {
    it('should throw error when trying to modify active version', async () => {
      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. active 버전 수정 시도 (에러 발생해야 함)
      await expect(
        mastersService.updateVersion(v1.id, {
          name: 'Modified Active Version',
        }),
      ).rejects.toThrow('Only draft versions can be modified');
    });

    it('should throw error when trying to modify inactive version', async () => {
      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. v2 생성 및 publish (v1은 inactive로)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await versionsService.publishVersion(v2.id, 'active');

      // 3. inactive 버전 (v1) 수정 시도 (에러 발생해야 함)
      await expect(
        mastersService.updateVersion(v1.id, {
          name: 'Modified Inactive Version',
        }),
      ).rejects.toThrow('Only draft versions can be modified');
    });

    it('should allow modifying draft version', async () => {
      // 1. v1 draft 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. draft 버전 수정 (정상 작동)
      await expect(
        mastersService.updateVersion(v1.id, {
          name: 'Modified Draft Version',
        }),
      ).resolves.toBeDefined();

      const updated = await versionsService.getVersionById(v1.id);
      expect(updated.name).toBe('Modified Draft Version');
    });
  });

  describe('Scenario 25: 동일 Master에 active 버전 1개만 존재', () => {
    it('should maintain only one active version per master', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 및 publish
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      await versionsService.publishVersion(v1.id, 'active');

      // 2. active 버전 1개 확인
      let activeVersions = await db
        .select()
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, v1.masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        );

      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0].id).toBe(v1.id);

      // 3. v2 생성 및 publish
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      await versionsService.publishVersion(v2.id, 'active');

      // 4. 여전히 active 버전 1개 (v2)
      activeVersions = await db
        .select()
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, v1.masterId),
            eq(productMasterVersions.versionStatus, 'active'),
          ),
        );

      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0].id).toBe(v2.id);

      // 5. v1은 inactive
      const v1Data = await versionsService.getVersionById(v1.id);
      expect(v1Data.versionStatus).toBe('inactive');
    });
  });

  describe('Scenario 26: parentVersionId 추적', () => {
    it('should track parent version lineage correctly', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });
      expect(v1.parentVersionId).toBeNull(); // 최초 버전

      // 2. v2 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);
      expect(v2.parentVersionId).toBe(v1.id);

      // 3. v3 생성 (from v2)
      const v3 = await versionsService.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123', true);
      expect(v3.parentVersionId).toBe(v2.id);

      // 4. v4 생성 (from v3)
      const v4 = await versionsService.createDraftVersion(v3.id, '019a0000-0000-0000-0000-000000000123', true);
      expect(v4.parentVersionId).toBe(v3.id);

      // 5. 계보 확인: v1 → v2 → v3 → v4
      const lineage = [v1.parentVersionId, v2.parentVersionId, v3.parentVersionId, v4.parentVersionId];
      expect(lineage).toEqual([null, v1.id, v2.id, v3.id]);
    });

    it('should track branching parent correctly', async () => {
      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. v2 생성 (from v1)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000a11ce0', true);

      // 3. v3도 v1에서 분기
      const v3 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-00000000b0b0', true);

      // 4. 두 분기 모두 v1을 부모로 가짐
      expect(v2.parentVersionId).toBe(v1.id);
      expect(v3.parentVersionId).toBe(v1.id);

      // 5. v4는 v2에서 생성
      const v4 = await versionsService.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000a11ce0', true);
      expect(v4.parentVersionId).toBe(v2.id);
    });
  });

  describe('Scenario 27: draftOwnerId 권한 검증', () => {
    it('should check if user can modify draft version', async () => {
      // 1. v1 생성 (owner: user-alice)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000a11ce0', true);

      // 2. owner 확인
      expect(v2.draftOwnerId).toBe('019a0000-0000-0000-0000-000000a11ce0');

      // 3. user-alice는 수정 가능
      const canAliceModify = await versionsService.canUserModifyVersion(v2.id, '019a0000-0000-0000-0000-000000a11ce0');
      expect(canAliceModify).toBe(true);

      // 4. user-bob은 수정 불가
      const canBobModify = await versionsService.canUserModifyVersion(v2.id, '019a0000-0000-0000-0000-00000000b0b0');
      expect(canBobModify).toBe(false);
    });

    it('should allow modification if draftOwnerId is null', async () => {
      // 1. v1 생성 (owner 없음)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // draftOwnerId null 설정은 createMaster에서 자동으로 됨
      expect(v1.draftOwnerId).toBeNull();

      // 2. 누구나 수정 가능
      const canAnyoneModify = await versionsService.canUserModifyVersion(v1.id, 'any-user');
      expect(canAnyoneModify).toBe(true);
    });

    it('should clear draftOwnerId after publish', async () => {
      // 1. v1 생성 (owner: user-alice)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000a11ce0', true);
      expect(v2.draftOwnerId).toBe('019a0000-0000-0000-0000-000000a11ce0');

      // 2. publish
      await versionsService.publishVersion(v2.id, 'active');

      // 3. draftOwnerId null로 변경됨
      const published = await versionsService.getVersionById(v2.id);
      expect(published.draftOwnerId).toBeNull();
    });
  });

  describe('Scenario 28: 고아 variant 정리 로직', () => {
    it('should delete variant only if no other version references it', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (default variant 포함)
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
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

      expect(v1Variants).toHaveLength(1);
      const sharedVariantId = v1Variants[0].variantId;

      // 2. v2 생성 (variant 복사됨)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      // 3. v2도 같은 variant 참조
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      expect(v2Variants[0].variantId).toBe(sharedVariantId);

      // 4. v2 삭제
      await versionsService.deleteDraftVersion(v2.id);

      // 5. variant는 여전히 존재 (v1이 참조 중)
      const variantStillExists = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, sharedVariantId));

      expect(variantStillExists).toHaveLength(1);

      // 6. v1도 삭제하면 variant도 삭제될 수 있음
      // (하지만 v1은 draft가 아니라 삭제 불가 - 이 테스트의 범위 밖)
    });

    it('should delete variant if only deleted draft referenced it', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성
      const v1 = await mastersService.createMaster({
        name: 'Product v1',
      });

      // 2. v2 생성 및 옵션 추가 (새 variant 생성)
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123', true);

      await mastersService.updateVersion(v2.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }],
            },
          ],
        },
      });

      // 3. v2의 새 variants 확인
      const v2Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v2.masterId),
            eq(productMasterVariants.version, v2.version),
          ),
        );

      const v2VariantIds = v2Variants.map((v) => v.variantId);

      // 4. v1의 variants 확인
      const v1Variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      const v1VariantIds = v1Variants.map((v) => v.variantId);

      // 5. v2만 참조하는 variant 찾기
      const v2OnlyVariantIds = v2VariantIds.filter((id) => !v1VariantIds.includes(id));

      // 6. v2 삭제
      await versionsService.deleteDraftVersion(v2.id);

      // 7. v2만 참조하던 variant는 삭제되어야 함
      for (const variantId of v2OnlyVariantIds) {
        const variantExists = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, variantId));

        expect(variantExists).toHaveLength(0);
      }
    });
  });

  describe('Scenario 29: 반복 테스트 - 옵션 추가/제거/다시 추가', () => {
    it('should handle repeated option additions and removals', async () => {
      const db = PimTestDatabase.getDb();

      // 1. v1 생성 (옵션 없음)
      const v1 = await mastersService.createMaster({
        name: 'Product',
      });

      let variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(variants).toHaveLength(1); // default variant

      // 2. 옵션 추가
      await mastersService.updateVersion(v1.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }, { displayName: '파랑' }],
            },
          ],
        },
      });

      variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(variants).toHaveLength(2);

      // 3. 옵션 그룹 찾기
      const optionGroup = await db.query.productMasterOptionGroups.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, v1.masterId),
            eq(t.version, v1.version),
          ),
      });

      // 4. 옵션 제거
      await mastersService.updateVersion(v1.id, {
        optionDiff: {
          remove: [optionGroup!.optionGroupId],
        },
      });

      variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(variants).toHaveLength(1); // back to default

      // 5. 다시 옵션 추가
      await mastersService.updateVersion(v1.id, {
        optionDiff: {
          add: [
            {
              displayName: '사이즈',
              values: [{ displayName: 'S' }, { displayName: 'M' }, { displayName: 'L' }],
            },
          ],
        },
      });

      variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, v1.masterId),
            eq(productMasterVariants.version, v1.version),
          ),
        );

      expect(variants).toHaveLength(3);

      // 6. 여전히 draft 상태
      const finalVersion = await versionsService.getVersionById(v1.id);
      expect(finalVersion.versionStatus).toBe('draft');
    });
  });
});

