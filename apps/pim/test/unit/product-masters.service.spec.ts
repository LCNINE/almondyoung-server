import { Test, TestingModule } from '@nestjs/testing';
import { ProductMastersService } from '../../src/services/product-masters.service';
import { PricingStrategyFactory } from '../../src/services/pricing/pricing-strategy.factory';
import { OptionBasedPricingStrategy } from '../../src/services/pricing/option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from '../../src/services/pricing/variant-based-pricing.strategy';
import { PimTestDatabase } from '../support/pim-test-database';
import { PimTestFactory } from '../support/pim-test-factory';
import { DbService } from '@app/db';
import { pimSchema } from '../../src/schema';
import type { CreateMasterDto } from '../../src/types';
import { eq } from 'drizzle-orm';

describe('ProductMastersService - CRUD Tests', () => {
  let service: ProductMastersService;
  let module: TestingModule;

  beforeAll(async () => {
    // testcontainers는 이미 jest-setup.ts에서 시작됨
    await PimTestDatabase.setup();

    // Mock StreamPublisher (이벤트 발행은 테스트 범위 밖)
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

  describe('createMaster()', () => {
    it('✅ 옵션 없는 간단한 상품(감자) 생성 테스트', async () => {
      const createDto: CreateMasterDto = {
        name: '국산 감자',
        description: '신선한 국산 감자입니다',
        brand: '농장직송',
        basePrice: 5000,
        pricingStrategy: 'option_based',
      };

      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('국산 감자');
      expect(result.basePrice).toBe(5000);
      expect(result.pricingStrategy).toBe('option_based');

      // DB 확인
      const savedMasters = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productMasters)
        .where(eq(pimSchema.productMasters.id, result.id));

      expect(savedMasters).toHaveLength(1);
      expect(savedMasters[0].name).toBe('국산 감자');
      expect(savedMasters[0].brand).toBe('농장직송');
    }, 10000);

    it('✅ 단일 옵션 그룹이 있는 상품(아이스티) 생성 테스트', async () => {
      const createDto: CreateMasterDto = {
        name: '프리미엄 아이스티',
        description: '시원하고 달콤한 아이스티',
        brand: '카페브랜드',
        basePrice: 3000,
        pricingStrategy: 'option_based',
        optionGroups: [{
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small (355ml)', price: 0 },
            { value: 'M', displayName: 'Medium (473ml)', price: 500 },
            { value: 'L', displayName: 'Large (591ml)', price: 1000 }
          ]
        }]
      };

      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.pricingStrategy).toBe('option_based');

      // 비동기 옵션 처리를 기다림 (setImmediate 사용하므로)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 옵션 그룹 확인
      const optionGroups = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionGroups)
        .where(eq(pimSchema.productOptionGroups.masterId, result.id));

      expect(optionGroups.length).toBeGreaterThan(0);
      if (optionGroups.length > 0) {
        expect(optionGroups[0].name).toBe('size');
        expect(optionGroups[0].displayName).toBe('사이즈');

        // 옵션 값 확인
        const optionValues = await PimTestDatabase.getDb()
          .select()
          .from(pimSchema.productOptionValues)
          .where(eq(pimSchema.productOptionValues.optionGroupId, optionGroups[0].id));

        expect(optionValues.length).toBeGreaterThanOrEqual(3);
      }
    }, 15000);

    it('✅ 다중 옵션 그룹이 있는 상품(티셔츠) 생성 테스트', async () => {
      const createDto: CreateMasterDto = {
        name: '프리미엄 티셔츠',
        description: '고품질 면 100% 티셔츠',
        brand: '패션브랜드',
        basePrice: 25000,
        pricingStrategy: 'option_based',
        optionGroups: [
          {
            name: 'size',
            displayName: '사이즈',
            values: [
              { value: 'S', displayName: 'Small', price: 0 },
              { value: 'M', displayName: 'Medium', price: 0 },
              { value: 'L', displayName: 'Large', price: 2000 },
              { value: 'XL', displayName: 'Extra Large', price: 3000 }
            ]
          },
          {
            name: 'color',
            displayName: '색상',
            values: [
              { value: 'black', displayName: '블랙', price: 0 },
              { value: 'white', displayName: '화이트', price: 0 },
              { value: 'navy', displayName: '네이비', price: 1000 }
            ]
          }
        ]
      };

      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.name).toBe('프리미엄 티셔츠');

      // 비동기 옵션 처리를 기다림
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 옵션 그룹 확인
      const optionGroups = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productOptionGroups)
        .where(eq(pimSchema.productOptionGroups.masterId, result.id));

      expect(optionGroups.length).toBeGreaterThanOrEqual(2);

      if (optionGroups.length >= 2) {
        // Variants 확인 (4 x 3 = 12개 조합)
        const variants = await PimTestDatabase.getDb()
          .select()
          .from(pimSchema.productVariants)
          .where(eq(pimSchema.productVariants.masterId, result.id));

        expect(variants.length).toBeGreaterThanOrEqual(12);
      }
    }, 15000);

    it('❌ 필수 필드 누락 시 에러', async () => {
      const invalidDto = {
        description: '설명만 있음',
      } as CreateMasterDto;

      await expect(service.createMaster(invalidDto)).rejects.toThrow();
    });
  });

  describe('getMasterById()', () => {
    it('✅ 존재하는 Master 조회 성공', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '테스트 조회용 상품',
        description: '조회 테스트용',
        brand: '테스트브랜드',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      });

      const result = await service.getMasterById(testMaster.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(testMaster.id);
      expect(result!.name).toBe('테스트 조회용 상품');
      expect(result!.basePrice).toBe(10000);
      expect(result!.brand).toBe('테스트브랜드');
    });

    it('❌ 존재하지 않는 Master 조회 시 null 반환', async () => {
      const result = await service.getMasterById('00000000-0000-0000-0000-000000000000');

      expect(result).toBeNull();
    });

    it('❌ 잘못된 UUID 형식으로 조회', async () => {
      await expect(service.getMasterById('invalid-uuid')).rejects.toThrow();
    });
  });

  describe('getMasters() - 목록 조회', () => {
    it('✅ 기본 페이징 (page, limit)', async () => {
      // 테스트 데이터 생성
      await PimTestFactory.createMaster({ name: 'Product 1', basePrice: 1000 });
      await PimTestFactory.createMaster({ name: 'Product 2', basePrice: 2000 });
      await PimTestFactory.createMaster({ name: 'Product 3', basePrice: 3000 });

      const result = await service.getMasters({
        page: 1,
        limit: 2
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(2);
    });

    it('✅ 필터링 (status, brand, search)', async () => {
      await PimTestFactory.createMaster({
        name: 'Apple Product',
        brand: 'Apple',
        basePrice: 10000
      });

      await PimTestFactory.createMaster({
        name: 'Samsung Product',
        brand: 'Samsung',
        basePrice: 20000
      });

      // Brand 필터
      const resultByBrand = await service.getMasters({
        brand: 'Apple',
        page: 1,
        limit: 10
      });

      expect(resultByBrand.data.length).toBe(1);
      expect(resultByBrand.data[0].name).toBe('Apple Product');

      // Search 필터
      const resultBySearch = await service.getMasters({
        search: 'Samsung',
        page: 1,
        limit: 10
      });

      expect(resultBySearch.data.length).toBe(1);
      expect(resultBySearch.data[0].name).toBe('Samsung Product');
    });

    it('✅ soft delete된 항목 제외', async () => {
      const master1 = await PimTestFactory.createMaster({ name: 'Active Product' });
      const master2 = await PimTestFactory.createMaster({ name: 'Deleted Product' });

      // master2 soft delete
      await service.softDelete(master2.id, '00000000-0000-0000-0000-000000000001');

      // 기본 조회 (includeDeleted = false)
      const result = await service.getMasters({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(master1.id);
    });

    it('✅ 빈 결과 처리', async () => {
      const result = await service.getMasters({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('updateMaster()', () => {
    it('✅ 기본 정보 수정 (name, description, basePrice 등)', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '원래 이름',
        description: '원래 설명',
        basePrice: 10000,
      });

      const updated = await service.updateMaster(testMaster.id, {
        name: '수정된 이름',
        description: '수정된 설명',
        basePrice: 15000,
      });

      expect(updated.name).toBe('수정된 이름');
      expect(updated.description).toBe('수정된 설명');
      expect(updated.basePrice).toBe(15000);
    });

    it('✅ 특수 가격 필드 수정 (membershipPrice, wholesalePrice)', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '테스트 상품',
        basePrice: 10000,
      });

      const updated = await service.updateMaster(testMaster.id, {
        membershipPrice: 8000,
        wholesalePrice: 7000,
        isMembershipOnly: true,
      });

      expect(updated.membershipPrice).toBe(8000);
      expect(updated.wholesalePrice).toBe(7000);
      expect(updated.isMembershipOnly).toBe(true);
    });

    it('❌ 존재하지 않는 Master 수정 시 에러', async () => {
      await expect(
        service.updateMaster('00000000-0000-0000-0000-000000000000', {
          name: '수정 시도'
        })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('softDelete() & restore()', () => {
    it('✅ Soft delete 성공 및 deletedAt, deletedBy 설정 확인', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '삭제 테스트 상품',
      });

      const deleted = await service.softDelete(testMaster.id, '00000000-0000-0000-0000-000000000001');

      expect(deleted.deletedAt).toBeDefined();
      expect(deleted.deletedAt).not.toBeNull();
      expect(deleted.deletedBy).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('✅ Soft delete된 항목은 기본 조회에서 제외', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '삭제될 상품',
      });

      await service.softDelete(testMaster.id, '00000000-0000-0000-0000-000000000001');

      // 기본 조회 (includeDeleted = false)
      const result = await service.getMasterById(testMaster.id);

      expect(result).toBeNull();

      // includeDeleted = true로 조회
      const resultWithDeleted = await service.getMasterById(testMaster.id, undefined, true);

      expect(resultWithDeleted).toBeDefined();
      expect(resultWithDeleted!.deletedAt).not.toBeNull();
    });

    it('✅ Restore 성공 및 deletedAt null로 복원', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '복원 테스트 상품',
      });

      await service.softDelete(testMaster.id, '00000000-0000-0000-0000-000000000001');

      const restored = await service.restore(testMaster.id, '00000000-0000-0000-0000-000000000002');

      expect(restored.deletedAt).toBeNull();
      expect(restored.deletedBy).toBeNull();

      // 기본 조회로 다시 보이는지 확인
      const result = await service.getMasterById(testMaster.id);
      expect(result).toBeDefined();
    });

    it('❌ 이미 삭제된 항목 재삭제 시 에러', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '중복 삭제 테스트',
      });

      await service.softDelete(testMaster.id, '00000000-0000-0000-0000-000000000001');

      await expect(
        service.softDelete(testMaster.id, '00000000-0000-0000-0000-000000000001')
      ).rejects.toThrow(/already deleted/i);
    });

    it('❌ 삭제되지 않은 항목 복원 시도 시 에러', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '복원 불가 테스트',
      });

      await expect(
        service.restore(testMaster.id, '00000000-0000-0000-0000-000000000001')
      ).rejects.toThrow(/not deleted/i);
    });
  });

  describe('hardDelete()', () => {
    it('✅ 영구 삭제 성공', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '영구 삭제 테스트',
      });

      const result = await service.hardDelete(testMaster.id, '00000000-0000-0000-0000-000000000001');

      expect(result.deleted).toBe(true);

      // 완전히 삭제되었는지 확인
      const checkResult = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productMasters)
        .where(eq(pimSchema.productMasters.id, testMaster.id));

      expect(checkResult).toHaveLength(0);
    });

    it('❌ 존재하지 않는 항목 삭제 시 에러', async () => {
      await expect(
        service.hardDelete('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001')
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('existsMaster()', () => {
    it('✅ 존재하는 Master 존재 확인', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '존재 확인용 상품',
        basePrice: 5000,
      });

      const exists = await service.existsMaster(testMaster.id);
      expect(exists).toBe(true);
    });

    it('❌ 존재하지 않는 Master 존재 확인', async () => {
      const exists = await service.existsMaster('00000000-0000-0000-0000-000000000000');
      expect(exists).toBe(false);
    });
  });

  describe('updateMasterStatus()', () => {
    it('✅ 상태 변경 (active, inactive, draft)', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '상태 변경용 상품',
        basePrice: 5000,
      });

      await service.updateMasterStatus(testMaster.id, 'inactive');

      const updatedMaster = await service.getMasterById(testMaster.id);
      expect(updatedMaster!.status).toBe('inactive');

      // DB 직접 확인
      const savedMaster = await PimTestDatabase.getDb()
        .select()
        .from(pimSchema.productMasters)
        .where(eq(pimSchema.productMasters.id, testMaster.id));

      expect(savedMaster[0].status).toBe('inactive');
    });

    it('❌ 잘못된 상태값 시 에러', async () => {
      const testMaster = await PimTestFactory.createMaster({
        name: '잘못된 상태 테스트',
      });

      await expect(
        service.updateMasterStatus(testMaster.id, 'invalid_status')
      ).rejects.toThrow(/Invalid status/i);
    });

    it('❌ 존재하지 않는 Master 상태 변경 시 에러', async () => {
      await expect(
        service.updateMasterStatus('00000000-0000-0000-0000-000000000000', 'inactive')
      ).rejects.toThrow(/not found/i);
    });
  });
});

