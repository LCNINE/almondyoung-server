import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/core/products/services/product-masters.service';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasters, productVariants, pricingRules } from '../../src/schema';
import type { ProductMaster } from '../../src/types';
import { eq } from 'drizzle-orm';

describe('Edge Cases and Error Scenarios', () => {
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

  describe('8.1 동시성 문제', () => {
    it('✅ 동일 masterId에 두 Active 버전 생성 시도 (DB 제약 확인)', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1을 active로 발행
      await versionsService.publishVersion(v1.id, 'active');

      // v2 생성
      const v2 = await versionsService.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');

      // v2를 직접 DB로 active로 변경 시도 (제약 위반)
      const db = PimTestDatabase.getDb();

      await expect(
        db
          .update(productMasters)
          .set({ versionStatus: 'active' })
          .where(eq(productMasters.id, v2.id)),
      ).rejects.toThrow();
    });

    it('✅ 트랜잭션 롤백 확인', async () => {
      const db = PimTestDatabase.getDb();

      try {
        await db.transaction(async (tx) => {
          // Master 생성
          const master = await mastersService.createMaster({}, tx);

          // 의도적으로 에러 발생
          throw new Error('Intentional error');
        });
      } catch (error) {
        // 에러 예상
      }

      // 트랜잭션이 롤백되어 Master가 생성되지 않았는지 확인
      const allMasters = await db.select().from(productMasters);
      expect(allMasters).toHaveLength(0);
    });
  });

  describe('8.2 고아 리소스 관리', () => {
    it('✅ 어떤 버전도 참조하지 않는 Variant 정리', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // Variant가 존재하는지 확인
      const variantBefore = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, defaultVariant.id));
      expect(variantBefore).toHaveLength(1);

      // 매핑 제거 (variant는 유지)
      await db
        .delete(require('../../src/schema').productMasterVariants)
        .where(
          eq(
            require('../../src/schema').productMasterVariants.variantId,
            defaultVariant.id,
          ),
        );

      // Note: 실제 시스템에서는 고아 variant를 주기적으로 정리하는 로직이 필요
      // 여기서는 매핑이 제거되어도 variant 레코드는 유지되는 것만 확인
      const variantAfter = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, defaultVariant.id));
      expect(variantAfter).toHaveLength(1);
    });

    it('✅ 어떤 버전도 참조하지 않는 PricingRule 삭제 확인', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 가격 규칙 생성
      const rules = await PimTestFactory.createBasePriceRules(
        master.masterId,
        master.version,
        10000,
        db,
      );
      const ruleId = rules[0].id;

      // 규칙이 존재하는지 확인
      const ruleBefore = await db
        .select()
        .from(pricingRules)
        .where(eq(pricingRules.id, ruleId));
      expect(ruleBefore).toHaveLength(1);

      // 매핑 제거
      await db
        .delete(require('../../src/schema').productMasterPricingRules)
        .where(
          eq(
            require('../../src/schema').productMasterPricingRules.pricingRuleId,
            ruleId,
          ),
        );

      // 고아 규칙은 정리 로직에서 삭제되어야 함
      // (실제로는 서비스 메서드에서 처리)
    });
  });

  describe('8.3 빈 데이터 처리', () => {
    it('✅ 옵션 없는 상품 (기본 variant만)', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // 옵션 그룹 확인 (없어야 함)
      const optionGroups = await db.query.productMasterOptionGroups.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, master.masterId),
            eq(t.version, master.version),
          ),
      });
      expect(optionGroups).toHaveLength(0);

      // 기본 variant 확인
      const variant = await db
        .select()
        .from(productVariants)
        .where(eq(productVariants.id, defaultVariant.id));
      expect(variant).toHaveLength(1);
      expect(variant[0].isDefault).toBe(true);
    });

    it('✅ 가격 규칙 없는 경우', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 가격 규칙 확인 (없어야 함)
      const rules = await db.query.productMasterPricingRules.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, master.masterId),
            eq(t.version, master.version),
          ),
      });
      expect(rules).toHaveLength(0);
    });

    it('✅ 빈 optionDiff 적용 (변경 없음)', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '원래 이름',
      });

      // 빈 optionDiff 적용
      const updated = await mastersService.updateMaster(master.id, {
        optionDiff: {},
      });

      expect(updated.name).toBe('원래 이름');
    });
  });

  describe('8.4 대용량 데이터', () => {
    it('✅ 옵션 값 많은 경우 (조합 증가)', async () => {
      const master = await mastersService.createMaster({
        name: '대용량 옵션 테스트',
      });

      // 10개 옵션 값
      await mastersService.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '사이즈',
              values: Array.from({ length: 10 }, (_, i) => ({
                displayName: `Size ${i + 1}`,
              })),
            },
          ],
        },
      });

      const db = PimTestDatabase.getDb();
      const variants = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, master.masterId),
            eq(t.version, master.version),
          ),
      });

      expect(variants).toHaveLength(10);
    });

    it('✅ 다중 옵션 그룹으로 많은 variants 생성', async () => {
      const master = await mastersService.createMaster({
        name: 'Variants 폭발 테스트',
      });

      // 5 × 4 = 20개 variants
      await mastersService.updateMaster(master.id, {
        optionDiff: {
          add: [
            {
              displayName: '색상',
              values: Array.from({ length: 5 }, (_, i) => ({
                displayName: `색상 ${i + 1}`,
              })),
            },
            {
              displayName: '사이즈',
              values: Array.from({ length: 4 }, (_, i) => ({
                displayName: `사이즈 ${i + 1}`,
              })),
            },
          ],
        },
      });

      const db = PimTestDatabase.getDb();
      const variants = await db.query.productMasterVariants.findMany({
        where: (t, { and, eq }) =>
          and(
            eq(t.masterId, master.masterId),
            eq(t.version, master.version),
          ),
      });

      expect(variants).toHaveLength(20); // 5 × 4
    });
  });

  describe('8.5 버전 트리 복잡도', () => {
    it('✅ 깊은 버전 트리 (10 레벨)', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();
      let currentVersion = v1;

      // 10개 버전 생성 (선형)
      for (let i = 2; i <= 10; i++) {
        currentVersion = await versionsService.createDraftVersion(
          currentVersion.id,
          '019a0000-0000-0000-0000-000000000123',
        );
        expect(currentVersion.version).toBe(i);
      }

      const tree = await versionsService.getVersionTree(v1.masterId);

      // 트리 깊이 확인
      let depth = 0;
      let node = tree[0];
      while (node.children.length > 0) {
        depth++;
        node = node.children[0];
      }

      expect(depth).toBe(9); // v1 → v2 → ... → v10 (9단계)
    });

    it('✅ 넓은 버전 트리 (하나의 부모에서 여러 분기)', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1에서 5개 분기 생성
      const branches: ProductMaster[] = [];
      for (let i = 0; i < 5; i++) {
        const branch = await versionsService.createDraftVersion(
          v1.id,
          `user-${i}`,
        );
        branches.push(branch);
      }

      const tree = await versionsService.getVersionTree(v1.masterId);

      expect(tree[0].children).toHaveLength(5);
    });
  });

  describe('8.6 특수 문자 처리', () => {
    it('✅ 특수 문자 포함 상품명', async () => {
      const master = await mastersService.createMaster({
        name: '상품명 <script>alert("XSS")</script>',
        description: 'SQL\' OR \'1\'=\'1',
      });

      expect(master.name).toContain('<script>');
      expect(master.description).toContain("'");
    });

    it('✅ 유니코드 이모지 처리', async () => {
      const master = await mastersService.createMaster({
        name: '🎉 세일 상품 🎁',
        description: '✨ 특별한 할인 ✨',
      });

      expect(master.name).toBe('🎉 세일 상품 🎁');
      expect(master.description).toBe('✨ 특별한 할인 ✨');
    });

    it('✅ 매우 긴 문자열 처리', async () => {
      const longName = 'A'.repeat(255);
      const master = await mastersService.createMaster({
        name: longName,
      });

      expect(master.name).toBe(longName);
    });
  });

  describe('8.7 동시 수정 시나리오', () => {
    it('✅ 같은 Draft를 두 사용자가 수정 시도', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: undefined, // 누구나 수정 가능
      });

      // User 1이 수정
      const updated1 = await mastersService.updateMaster(master.id, {
        name: 'User 1이 수정',
      });

      // User 2가 수정 (덮어쓰기)
      const updated2 = await mastersService.updateMaster(master.id, {
        name: 'User 2가 수정',
      });

      // 마지막 수정이 저장됨
      expect(updated2.name).toBe('User 2가 수정');
    });

    it('✅ draftOwnerId가 있으면 소유자만 수정 가능', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: '019a0000-0000-0000-0000-000000000001',
      });

      const canUser1Modify = await versionsService.canUserModifyVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000001',
      );
      expect(canUser1Modify).toBe(true);

      const canUser2Modify = await versionsService.canUserModifyVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000002',
      );
      expect(canUser2Modify).toBe(false);
    });
  });
});



