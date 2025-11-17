import { Test, TestingModule } from '@nestjs/testing';
import { ProductVersionsService } from '../../src/core/products/services/product-versions.service';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { productMasters, productMasterOptionGroups, productMasterVariants, productMasterPricingRules } from '../../src/schema';
import { eq, and } from 'drizzle-orm';

describe('ProductVersionsService - Version Management Tests', () => {
  let service: ProductVersionsService;
  let module: TestingModule;

  beforeAll(async () => {
    await PimTestDatabase.setup();

    module = await Test.createTestingModule({
      providers: [
        ProductVersionsService,
        {
          provide: DbService,
          useFactory: () => ({
            db: PimTestDatabase.getDb(),
          }),
        },
      ],
    }).compile();

    service = module.get<ProductVersionsService>(ProductVersionsService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await PimTestDatabase.clearAllTables();
  });

  describe('4.1 버전 생성', () => {
    it('✅ 새 draft 버전 생성 (부모 기반)', async () => {
      const { master: parent } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '부모 버전',
      });

      const newVersion = await service.createDraftVersion(
        parent.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );

      expect(newVersion).toBeDefined();
      expect(newVersion.masterId).toBe(parent.masterId);
      expect(newVersion.version).toBe(2); // 부모가 1, 새 버전은 2
      expect(newVersion.parentVersionId).toBe(parent.id);
      expect(newVersion.versionStatus).toBe('draft');
      expect(newVersion.draftOwnerId).toBe('019a0000-0000-0000-0000-000000000123');
    });

    it('✅ 버전 번호 자동 증가 확인', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');
      expect(v2.version).toBe(2);

      const v3 = await service.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123');
      expect(v3.version).toBe(3);

      const v4 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');
      expect(v4.version).toBe(4); // v1에서 분기해도 증가
    });

    it('✅ 부모 필드 복사 확인', async () => {
      const { master: parent } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '복사될 이름',
        description: '복사될 설명',
        brand: '복사될 브랜드',
      });

      const child = await service.createDraftVersion(parent.id, '019a0000-0000-0000-0000-000000000123');

      expect(child.name).toBe(parent.name);
      expect(child.description).toBe(parent.description);
      expect(child.brand).toBe(parent.brand);
    });

    it('✅ parentVersionId 설정 확인', async () => {
      const { master: parent } = await PimTestFactory.createDraftMasterWithBasicInfo();

      const child = await service.createDraftVersion(parent.id, '019a0000-0000-0000-0000-000000000123');

      expect(child.parentVersionId).toBe(parent.id);
    });

    it('✅ draftOwnerId 설정', async () => {
      const { master: parent } = await PimTestFactory.createDraftMasterWithBasicInfo();

      const child = await service.createDraftVersion(parent.id, '019a0000-0000-0000-0000-000000000456');

      expect(child.draftOwnerId).toBe('019a0000-0000-0000-0000-000000000456');
    });
  });

  describe('4.2 매핑 복사', () => {
    it('✅ 옵션 그룹 매핑 복사 (copyMappings=true)', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 옵션 그룹 추가
      const group = await PimTestFactory.createOptionGroup(db);
      await PimTestFactory.linkOptionGroupToMaster(
        master.masterId,
        group.id,
        master.version,
        db,
      );
      await PimTestFactory.createOptionGroupDisplay(
        group.id,
        master.masterId,
        master.version,
        { displayName: '색상' },
        db,
      );

      // 새 버전 생성 (매핑 복사)
      const newVersion = await service.createDraftVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );

      // 옵션 그룹 매핑 복사 확인
      const mappings = await db
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, newVersion.masterId),
            eq(productMasterOptionGroups.version, newVersion.version),
          ),
        );

      expect(mappings).toHaveLength(1);
      expect(mappings[0].optionGroupId).toBe(group.id);
    });

    it('✅ Variant 매핑 복사', async () => {
      const db = PimTestDatabase.getDb();
      const { master, defaultVariant } =
        await PimTestFactory.createDraftMasterWithBasicInfo();

      // 새 버전 생성 (매핑 복사)
      const newVersion = await service.createDraftVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );

      // Variant 매핑 복사 확인
      const mappings = await db
        .select()
        .from(productMasterVariants)
        .where(
          and(
            eq(productMasterVariants.masterId, newVersion.masterId),
            eq(productMasterVariants.version, newVersion.version),
          ),
        );

      expect(mappings).toHaveLength(1);
      expect(mappings[0].variantId).toBe(defaultVariant.id);
    });

    it('✅ 가격 규칙 매핑 복사', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 가격 규칙 추가
      await PimTestFactory.createBasePriceRules(
        master.masterId,
        master.version,
        10000,
        db,
      );

      // 새 버전 생성 (매핑 복사)
      const newVersion = await service.createDraftVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000123',
        true,
      );

      // 가격 규칙 매핑 복사 확인
      const mappings = await db
        .select()
        .from(productMasterPricingRules)
        .where(
          and(
            eq(productMasterPricingRules.masterId, newVersion.masterId),
            eq(productMasterPricingRules.version, newVersion.version),
          ),
        );

      expect(mappings).toHaveLength(1);
    });

    it('✅ copyMappings=false 시 매핑 제외', async () => {
      const db = PimTestDatabase.getDb();
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 옵션 그룹 추가
      const group = await PimTestFactory.createOptionGroup(db);
      await PimTestFactory.linkOptionGroupToMaster(
        master.masterId,
        group.id,
        master.version,
        db,
      );

      // 새 버전 생성 (매핑 제외)
      const newVersion = await service.createDraftVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000123',
        false,
      );

      // 옵션 그룹 매핑이 없어야 함
      const mappings = await db
        .select()
        .from(productMasterOptionGroups)
        .where(
          and(
            eq(productMasterOptionGroups.masterId, newVersion.masterId),
            eq(productMasterOptionGroups.version, newVersion.version),
          ),
        );

      expect(mappings).toHaveLength(0);
    });
  });

  describe('4.3 버전 Publish', () => {
    it('✅ Draft → Active 전환', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.publishVersion(master.id, 'active');
      const published = await service.getVersionById(master.id);

      expect(published.versionStatus).toBe('active');
      expect(published.draftOwnerId).toBeNull();
    });

    it('✅ Draft → Inactive 전환', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.publishVersion(master.id, 'inactive');
      const published = await service.getVersionById(master.id);

      expect(published.versionStatus).toBe('inactive');
      expect(published.draftOwnerId).toBeNull();
    });

    it('✅ 기존 Active 자동 Inactive 처리', async () => {
      const db = PimTestDatabase.getDb();
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // v1을 active로 발행
      await service.publishVersion(v1.id, 'active');

      // v2 생성 및 active로 발행
      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');
      await service.publishVersion(v2.id, 'active');

      // v1이 inactive로 변경되었는지 확인
      const [v1Updated] = await db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, v1.id));

      expect(v1Updated.versionStatus).toBe('inactive');
    });

    it('✅ draftOwnerId 제거 확인', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: '019a0000-0000-0000-0000-000000000123',
      });

      await service.publishVersion(master.id, 'active');
      const published = await service.getVersionById(master.id);

      expect(published.draftOwnerId).toBeNull();
    });

    it('❌ Draft가 아닌 버전 publish 시도', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // 먼저 active로 발행
      await service.publishVersion(master.id, 'active');

      // 다시 publish 시도
      await expect(
        service.publishVersion(master.id, 'active'),
      ).rejects.toThrow(/only.*draft/i);
    });
  });

  describe('4.4 버전 조회', () => {
    it('✅ Active 버전 조회', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.publishVersion(master.id, 'active');

      const active = await service.getActiveVersion(master.masterId);

      expect(active.id).toBe(master.id);
      expect(active.versionStatus).toBe('active');
    });

    it('✅ 버전 트리 조회 (부모-자식 구조)', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();
      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');
      const v3 = await service.createDraftVersion(v2.id, '019a0000-0000-0000-0000-000000000123');

      const tree = await service.getVersionTree(v1.masterId);

      expect(tree).toHaveLength(1); // 1개의 root
      expect(tree[0].id).toBe(v1.id);
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].id).toBe(v2.id);
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].id).toBe(v3.id);
    });

    it('✅ 특정 버전 조회 (by versionId)', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '테스트 상품',
      });

      const retrieved = await service.getVersionById(master.id);

      expect(retrieved.id).toBe(master.id);
      expect(retrieved.name).toBe('테스트 상품');
    });

    it('✅ 트리 분기 확인 (하나의 부모에서 여러 자식)', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo();
      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');
      const v3 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000456'); // v1에서 분기

      const tree = await service.getVersionTree(v1.masterId);

      expect(tree).toHaveLength(1); // 1개의 root
      expect(tree[0].children).toHaveLength(2); // 2개의 자식 (v2, v3)
    });

    it('❌ Active 버전 없는 경우 에러', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      // Active 버전 없이 조회 시도
      await expect(
        service.getActiveVersion(master.masterId),
      ).rejects.toThrow(/no active version/i);
    });
  });

  describe('4.5 버전 비교', () => {
    it('✅ 두 버전 간 필드 차이 반환', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '원래 이름',
        description: '원래 설명',
      });

      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');

      // v2 수정
      const db = PimTestDatabase.getDb();
      await db
        .update(productMasters)
        .set({
          name: '변경된 이름',
          description: '원래 설명', // 동일
          brand: '새 브랜드',
        })
        .where(eq(productMasters.id, v2.id));

      const diffs = await service.compareVersions(v1.id, v2.id);

      // name과 brand가 변경됨
      expect(diffs.length).toBeGreaterThan(0);
      const nameDiff = diffs.find((d) => d.field === 'name');
      expect(nameDiff).toBeDefined();
      expect(nameDiff?.oldValue).toBe('원래 이름');
      expect(nameDiff?.newValue).toBe('변경된 이름');
    });

    it('✅ 변경된 필드만 포함', async () => {
      const { master: v1 } = await PimTestFactory.createDraftMasterWithBasicInfo({
        name: '이름',
        description: '설명',
      });

      const v2 = await service.createDraftVersion(v1.id, '019a0000-0000-0000-0000-000000000123');

      // v2에서 name만 변경
      const db = PimTestDatabase.getDb();
      await db
        .update(productMasters)
        .set({ name: '변경된 이름' })
        .where(eq(productMasters.id, v2.id));

      const diffs = await service.compareVersions(v1.id, v2.id);

      const nameExists = diffs.some((d) => d.field === 'name');
      const descriptionExists = diffs.some((d) => d.field === 'description');

      expect(nameExists).toBe(true);
      expect(descriptionExists).toBe(false); // 변경되지 않음
    });
  });

  describe('4.6 권한 확인', () => {
    it('✅ Draft 소유자 확인 (canUserModifyVersion)', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: '019a0000-0000-0000-0000-000000000123',
      });

      const canModify = await service.canUserModifyVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000123',
      );

      expect(canModify).toBe(true);
    });

    it('✅ draftOwnerId null이면 누구나 수정 가능', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: undefined,
      });

      const canModify = await service.canUserModifyVersion(
        master.id,
        'any-user',
      );

      expect(canModify).toBe(true);
    });

    it('❌ 다른 사용자는 수정 불가', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo({
        draftOwnerId: '019a0000-0000-0000-0000-000000000123',
      });

      const canModify = await service.canUserModifyVersion(
        master.id,
        '019a0000-0000-0000-0000-000000000456',
      );

      expect(canModify).toBe(false);
    });

    it('❌ Active/Inactive는 항상 false', async () => {
      const { master } = await PimTestFactory.createDraftMasterWithBasicInfo();

      await service.publishVersion(master.id, 'active');

      const canModify = await service.canUserModifyVersion(master.id, 'any-user');

      expect(canModify).toBe(false);
    });
  });
});



