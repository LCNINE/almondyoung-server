import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { pimSchema, productMasters, productVariants, productMasterVariants } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('ProductMastersService - Version Management Tests', () => {
  let service: ProductMastersService;
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
    versionsService = module.get<ProductVersionsService>(ProductVersionsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('3.1 상품 생성 (Create-Then-Update 패턴)', () => {
    it('✅ 빈 draft 생성 (빈 객체)', async () => {
      const master = await service.createMaster({});

      expect(master).toBeDefined();
      expect(master.id).toBeDefined();
      expect(master.masterId).toBeDefined();
      expect(master.version).toBe(1);
      expect(master.versionStatus).toBe('draft');
      expect(master.parentVersionId).toBeNull();
      expect(master.name).toBe('새 상품');
    });

    it('✅ 기본 정보 포함 생성', async () => {
      const master = await service.createMaster({
        name: '무선 이어폰',
        description: '고음질 무선 이어폰',
        brand: '테스트 브랜드',
      });

      expect(master.name).toBe('무선 이어폰');
      expect(master.description).toBe('고음질 무선 이어폰');
      expect(master.brand).toBe('테스트 브랜드');
      expect(master.versionStatus).toBe('draft');
    });

    it('✅ masterId와 versionId 별도 생성 확인', async () => {
      const master = await service.createMaster({});

      expect(master.id).not.toBe(master.masterId);
      expect(master.id).toBeDefined();
      expect(master.masterId).toBeDefined();
    });

    it('✅ 첫 버전은 version=1, status=draft', async () => {
      const master = await service.createMaster({});

      expect(master.version).toBe(1);
      expect(master.versionStatus).toBe('draft');
    });

    it('✅ 기본 variant 1개 자동 생성 (isDefault=true)', async () => {
      const master = await service.createMaster({});

      const db = PimTestDatabase.getDb();
      const variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      expect(variants).toHaveLength(1);

      const [variantMapping] = variants;
      const [variant] = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, variantMapping.variantId));

      expect(variant.isDefault).toBe(true);
      expect(variant.status).toBe('active');
    });
  });

  describe('3.2 상품 수정', () => {
    it('✅ Draft 버전 수정 가능', async () => {
      const master = await service.createMaster({
        name: '원래 이름',
      });

      const updated = await service.updateMaster(master.id, {
        name: '변경된 이름',
        description: '새 설명',
      });

      expect(updated.name).toBe('변경된 이름');
      expect(updated.description).toBe('새 설명');
    });

    it('❌ Active 버전 수정 불가', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Publish to active
      await PimTestFactory.publishVersion(master.id, 'active');

      // Try to update
      await expect(
        service.updateMaster(master.id, { name: '변경 시도' }),
      ).rejects.toThrow(/only.*draft/i);
    });

    it('❌ Inactive 버전 수정 불가', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Publish to inactive
      await PimTestFactory.publishVersion(master.id, 'inactive');

      // Try to update
      await expect(
        service.updateMaster(master.id, { name: '변경 시도' }),
      ).rejects.toThrow(/only.*draft/i);
    });

    it('✅ 필드 부분 업데이트 (name만)', async () => {
      const master = await service.createMaster({
        name: '원래 이름',
        description: '원래 설명',
      });

      const updated = await service.updateMaster(master.id, {
        name: '변경된 이름',
      });

      expect(updated.name).toBe('변경된 이름');
      expect(updated.description).toBe('원래 설명'); // 변경되지 않음
    });
  });

  describe('3.3 옵션 관리 (optionDiff)', () => {
    it('✅ 옵션 추가 (add) - 새 옵션 그룹 + 값들', async () => {
      const master = await service.createMaster({
        name: '옵션 테스트 상품',
      });

      await service.updateMaster(master.id, {
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

      const db = PimTestDatabase.getDb();
      const updated = await PimTestFactory.getMasterById(master.id, db);

      // Verify master still exists
      expect(updated).toBeDefined();
      expect(updated.name).toBe('옵션 테스트 상품');
    });

    it('✅ 옵션 추가 시 variants 자동 재생성', async () => {
      const master = await service.createMaster({});

      const db = PimTestDatabase.getDb();

      // 기본 variant 1개 확인
      let variantsBefore = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );
      expect(variantsBefore).toHaveLength(1);

      // 옵션 추가
      await service.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '사이즈',
              values: [
                { displayName: 'S' },
                { displayName: 'M' },
                { displayName: 'L' },
              ],
            },
          ],
        },
      });

      // Variants 재생성 확인 (3개)
      let variantsAfter = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );
      expect(variantsAfter).toHaveLength(3);
    });

    it('✅ 기존 기본 variant 삭제 후 조합 생성 확인', async () => {
      const master = await service.createMaster({});

      const db = PimTestDatabase.getDb();

      // 기본 variant ID 저장
      const [defaultVariantMapping] = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      const defaultVariantId = defaultVariantMapping.variantId;

      // 옵션 추가
      await service.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }, { displayName: '파랑' }],
            },
          ],
        },
      });

      // 기본 variant가 매핑에서 제거되었는지 확인
      const defaultVariantStillMapped = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
            eq(productMasterVariants.variantId, defaultVariantId),
          ),
        );

      expect(defaultVariantStillMapped).toHaveLength(0);
    });
  });

  describe('3.4 Variant 자동 생성', () => {
    it('✅ 단일 옵션 그룹 (3개 조합)', async () => {
      const master = await service.createMaster({});

      await service.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '사이즈',
              values: [
                { displayName: 'S' },
                { displayName: 'M' },
                { displayName: 'L' },
              ],
            },
          ],
        },
      });

      const db = PimTestDatabase.getDb();
      const variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      expect(variants).toHaveLength(3);
    });

    it('✅ 다중 옵션 그룹 (3×4 = 12개 조합)', async () => {
      const master = await service.createMaster({});

      await service.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '사이즈',
              values: [
                { displayName: 'S' },
                { displayName: 'M' },
                { displayName: 'L' },
              ],
            },
            {
              displayName: '색상',
              values: [
                { displayName: '빨강' },
                { displayName: '파랑' },
                { displayName: '녹색' },
                { displayName: '검정' },
              ],
            },
          ],
        },
      });

      const db = PimTestDatabase.getDb();
      const variants = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      expect(variants).toHaveLength(12); // 3 × 4 = 12
    });

    it('✅ Variant-OptionValue 매핑 확인', async () => {
      const master = await service.createMaster({});

      await service.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: [{ displayName: '빨강' }, { displayName: '파랑' }],
            },
          ],
        },
      });

      const db = PimTestDatabase.getDb();
      const variantMappings = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, master.masterId),
            eq(productMasterVariants.version, master.version),
          ),
        );

      // 각 variant가 옵션 값과 연결되어 있는지 확인
      for (const mapping of variantMappings) {
        const { variantOptionValues } = pimSchema;
        const optionValues = await db
          .select()
          .from(variantOptionValues)
          .where(eq(variantOptionValues.variantId, mapping.variantId));

        expect(optionValues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('3.5 에러 처리', () => {
    it('❌ 존재하지 않는 Master 조회', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(
        service.getMasterById(fakeId),
      ).rejects.toThrow(/not found/i);
    });

    it('❌ 존재하지 않는 버전 수정', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await expect(
        service.updateMaster(fakeId, { name: '변경 시도' }),
      ).rejects.toThrow();
    });
  });
});
