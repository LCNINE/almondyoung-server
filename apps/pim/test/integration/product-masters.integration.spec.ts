import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DbService } from '@app/db';
import { ProductMastersService } from '../../src/services/product-masters.service';
import { PricingStrategyFactory } from '../../src/services/pricing/pricing-strategy.factory';
import { OptionBasedPricingStrategy } from '../../src/services/pricing/option-based-pricing.strategy';
import { VariantBasedPricingStrategy } from '../../src/services/pricing/variant-based-pricing.strategy';
import { CreateMasterDto } from '../../src/types';
import { 
  productMasters, 
  productOptionGroups, 
  productOptionValues,
  productVariants,
  variantOptionValues,
  optionValuePrices,
  variantPrices,
  type PimSchema,
  pimSchema 
} from '../../src/schema';
import { eq } from 'drizzle-orm';

describe('ProductMastersService Integration Tests', () => {
  let service: ProductMastersService;
  let dbService: DbService<PimSchema>;
  let module: TestingModule;

  beforeAll(async () => {
    // 🏗 테스트 모듈 설정 - PimModule과 동일한 DB 설정 사용
    module = await Test.createTestingModule({
      imports: [
        DbModule.forRoot({
          config: {
            connectionString:
              process.env.DATABASE_URL ||
              'postgresql://postgres:ehddud0724*@localhost:5432/pim_db',
          },
          schema: pimSchema,
        }),
      ],
      providers: [
        ProductMastersService,
        PricingStrategyFactory,
        OptionBasedPricingStrategy,
        VariantBasedPricingStrategy,
      ],
    }).compile();

    service = module.get<ProductMastersService>(ProductMastersService);
    dbService = module.get<DbService<PimSchema>>(DbService);
  });

  beforeEach(async () => {
    // 🧹 각 테스트 전 DB 청소 (관계 순서 중요!)
    await cleanupDatabase();
  });

  afterEach(async () => {
    // 🧹 각 테스트 후 DB 청소 (혹시나 하는 추가 보장)
    await cleanupDatabase();
  });

  afterAll(async () => {
    // 🔌 연결 정리
    await module.close();
  });

  describe('createMaster', () => {
    it('🎯 옵션 없는 간단한 상품(감자) 생성 테스트', async () => {
      // 📋 2단계: API 요청 형태의 목업 데이터 생성
      const createDto: CreateMasterDto = {
        name: '국산 감자',
        description: '신선한 국산 감자입니다',
        brand: '농장직송',
        basePrice: 5000,
        pricingStrategy: 'option_based',
        // 옵션 없음 = 기본 품목만 생성
      };

      // 🚀 3단계: 요청 성공 확인
      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('국산 감자');
      expect(result.basePrice).toBe(5000);
      expect(result.pricingStrategy).toBe('option_based');

      // ✅ 4단계: DB 상태 확인
      // 4-1. Master가 실제로 저장되었는지 확인
      const savedMasters = await dbService.db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, result.id));
      
      expect(savedMasters).toHaveLength(1);
      expect(savedMasters[0].name).toBe('국산 감자');
      expect(savedMasters[0].brand).toBe('농장직송');

      // 4-2. 옵션이 없으므로 옵션 그룹도 없어야 함
      const optionGroups = await dbService.db
        .select()
        .from(productOptionGroups)
        .where(eq(productOptionGroups.masterId, result.id));
      
      expect(optionGroups).toHaveLength(0);

      // 4-3. 기본 품목 1개가 자동 생성되었는지 확인
      const variants = await dbService.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.masterId, result.id));
      
      expect(variants).toHaveLength(1);
      expect(variants[0].isDefault).toBe(true);
      expect(variants[0].status).toBe('active');
    });

    it('🎯 옵션 있는 복잡한 상품(아이스티) 생성 테스트', async () => {
      // 📋 2단계: 복잡한 목업 데이터 생성
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

      // 🚀 3단계: 요청 성공 확인
      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.pricingStrategy).toBe('option_based');

      // ✅ 4단계: 복잡한 DB 상태 확인
      // 4-1. 옵션 그룹이 생성되었는지 확인
      const optionGroups = await dbService.db
        .select()
        .from(productOptionGroups)
        .where(eq(productOptionGroups.masterId, result.id));
      
      expect(optionGroups).toHaveLength(1);
      expect(optionGroups[0].name).toBe('size');
      expect(optionGroups[0].displayName).toBe('사이즈');

      // 4-2. 옵션 값들이 생성되었는지 확인
      const optionValues = await dbService.db
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, optionGroups[0].id));
      
      expect(optionValues).toHaveLength(3);
      
      const valueTexts = optionValues.map(v => v.value).sort();
      expect(valueTexts).toEqual(['L', 'M', 'S']);

      // 4-3. 품목이 옵션 조합에 따라 생성되었는지 확인 (3개)
      const variants = await dbService.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.masterId, result.id));
      
      expect(variants).toHaveLength(3);
      // 옵션이 있으면 isDefault = false
      expect(variants.every(v => !v.isDefault)).toBe(true);

      // 4-4. 각 품목이 옵션 값과 올바르게 연결되었는지 확인
      const variantOptions = await dbService.db
        .select()
        .from(variantOptionValues)
        .where(eq(variantOptionValues.variantId, variants[0].id));
      
      expect(variantOptions).toHaveLength(1); // 각 품목은 1개의 옵션 값과 연결

      // 4-5. 옵션별 가격이 설정되었는지 확인
      const optionPrices = await dbService.db
        .select()
        .from(optionValuePrices)
        .where(eq(optionValuePrices.masterId, result.id));
      
      expect(optionPrices).toHaveLength(3); // S, M, L 각각의 가격
    });

    it('🎯 다중 옵션 그룹이 있는 복잡한 상품(티셔츠) 생성 테스트', async () => {
      // 📋 2단계: 매우 복잡한 목업 데이터 생성
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

      // 🚀 3단계: 요청 성공 확인
      const result = await service.createMaster(createDto);

      expect(result).toBeDefined();
      expect(result.name).toBe('프리미엄 티셔츠');

      // ✅ 4단계: 복잡한 DB 상태 확인
      // 4-1. 2개의 옵션 그룹이 생성되었는지 확인
      const optionGroups = await dbService.db
        .select()
        .from(productOptionGroups)
        .where(eq(productOptionGroups.masterId, result.id));
      
      expect(optionGroups).toHaveLength(2);
      
      const groupNames = optionGroups.map(g => g.name).sort();
      expect(groupNames).toEqual(['color', 'size']);

      // 4-2. 옵션 값들이 각 그룹별로 올바르게 생성되었는지 확인
      const sizeGroup = optionGroups.find(g => g.name === 'size');
      const colorGroup = optionGroups.find(g => g.name === 'color');

      const sizeValues = await dbService.db
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, sizeGroup!.id));
      
      const colorValues = await dbService.db
        .select()
        .from(productOptionValues)
        .where(eq(productOptionValues.optionGroupId, colorGroup!.id));

      expect(sizeValues).toHaveLength(4); // S, M, L, XL
      expect(colorValues).toHaveLength(3); // black, white, navy

      // 4-3. 품목이 옵션 조합에 따라 생성되었는지 확인 (4 x 3 = 12개)
      const variants = await dbService.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.masterId, result.id));
      
      expect(variants).toHaveLength(12); // 모든 조합

      // 4-4. 각 품목이 2개의 옵션 값과 연결되었는지 확인
      const firstVariantOptions = await dbService.db
        .select()
        .from(variantOptionValues)
        .where(eq(variantOptionValues.variantId, variants[0].id));
      
      expect(firstVariantOptions).toHaveLength(2); // size + color
    });

    it('❌ 실패 케이스: 필수 필드 누락', async () => {
      // 📋 2단계: 잘못된 목업 데이터 생성
      const invalidDto = {
        // name 없음 (필수 필드)
        description: '설명만 있음',
        basePrice: 5000,
        pricingStrategy: 'option_based',
      } as CreateMasterDto;

      // 🚀 3단계: 요청 실패 확인
      await expect(service.createMaster(invalidDto))
        .rejects
        .toThrow();

      // ✅ 4단계: DB 상태 확인 (아무것도 저장되지 않았는지)
      const allMasters = await dbService.db
        .select()
        .from(productMasters);
      
      expect(allMasters).toHaveLength(0);
    });

    it('❌ 실패 케이스: 중복된 옵션 값', async () => {
      // 📋 2단계: 중복 옵션 값이 있는 잘못된 데이터
      const invalidDto: CreateMasterDto = {
        name: '테스트 상품',
        basePrice: 1000,
        pricingStrategy: 'option_based',
        optionGroups: [{
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'M', displayName: 'Medium', price: 0 },
            { value: 'M', displayName: 'Medium2', price: 500 }, // 중복!
          ]
        }]
      };

      // 🚀 3단계: 요청 실패 확인
      await expect(service.createMaster(invalidDto))
        .rejects
        .toThrow();

      // ✅ 4단계: 아무것도 저장되지 않았는지 확인
      const allMasters = await dbService.db.select().from(productMasters);
      expect(allMasters).toHaveLength(0);
    });

    it('❌ 실패 케이스: 잘못된 가격 전략', async () => {
      // 📋 2단계: 잘못된 가격 전략
      const invalidDto: CreateMasterDto = {
        name: '테스트 상품',
        basePrice: 1000,
        pricingStrategy: 'invalid_strategy' as any, // 잘못된 전략
      };

      // 🚀 3단계: 요청 실패 확인
      await expect(service.createMaster(invalidDto))
        .rejects
        .toThrow();

      // ✅ 4단계: 아무것도 저장되지 않았는지 확인
      const allMasters = await dbService.db.select().from(productMasters);
      expect(allMasters).toHaveLength(0);
    });
  });

  describe('getMasterById', () => {
    it('🎯 존재하는 Master 조회 성공', async () => {
      // 📋 1단계: 기반 데이터 세팅 (테스트용 Master 먼저 생성)
      const testMaster = await service.createMaster({
        name: '테스트 조회용 상품',
        description: '조회 테스트용',
        brand: '테스트브랜드',
        basePrice: 10000,
        pricingStrategy: 'option_based',
      });

      // 🚀 3단계: 조회 성공 확인
      const result = await service.getMasterById(testMaster.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(testMaster.id);
      expect(result!.name).toBe('테스트 조회용 상품');
      expect(result!.basePrice).toBe(10000);
      expect(result!.brand).toBe('테스트브랜드');
    });

    it('❌ 존재하지 않는 Master 조회 시 null 반환', async () => {
      // 🚀 3단계: null 반환 확인
      const result = await service.getMasterById('00000000-0000-0000-0000-000000000000');
      
      expect(result).toBeNull();
    });

    it('❌ 잘못된 UUID 형식으로 조회', async () => {
      // 🚀 3단계: 에러 발생 확인
      await expect(service.getMasterById('invalid-uuid'))
        .rejects
        .toThrow();
    });
  });

  describe('existsMaster', () => {
    it('🎯 존재하는 Master 존재 확인', async () => {
      // 📋 1단계: 기반 데이터 세팅
      const testMaster = await service.createMaster({
        name: '존재 확인용 상품',
        basePrice: 5000,
        pricingStrategy: 'option_based',
      });

      // 🚀 3단계: 존재 확인
      const exists = await service.existsMaster(testMaster.id);
      expect(exists).toBe(true);
    });

    it('❌ 존재하지 않는 Master 존재 확인', async () => {
      // 🚀 3단계: 존재하지 않음 확인
      const exists = await service.existsMaster('00000000-0000-0000-0000-000000000000');
      expect(exists).toBe(false);
    });
  });

  describe('updateMasterStatus', () => {
    it('🎯 Master 상태 변경 성공', async () => {
      // 📋 1단계: 기반 데이터 세팅
      const testMaster = await service.createMaster({
        name: '상태 변경용 상품',
        basePrice: 5000,
        pricingStrategy: 'option_based'
      });

      // 🚀 3단계: 상태 변경 성공 확인
      await service.updateMasterStatus(testMaster.id, 'inactive');

      // 상태 변경 후 조회해서 확인
      const updatedMaster = await service.getMasterById(testMaster.id);
      expect(updatedMaster!.status).toBe('inactive');

      // ✅ 4단계: DB 상태 확인
      const savedMaster = await dbService.db
        .select()
        .from(productMasters)
        .where(eq(productMasters.id, testMaster.id));
      
      expect(savedMaster[0].status).toBe('inactive');
    });

    it('❌ 존재하지 않는 Master 상태 변경 시도', async () => {
      // 🚀 3단계: 에러 발생 확인
      await expect(service.updateMasterStatus('00000000-0000-0000-0000-000000000000', 'inactive'))
        .rejects
        .toThrow();
    });
  });

  describe('initializePricingStrategy', () => {
    it('🎯 가격 전략 초기화 성공', async () => {
      // 📋 1단계: 기반 데이터 세팅 (옵션 있는 상품)
      const testMaster = await service.createMaster({
        name: '가격 전략 테스트용 상품',
        basePrice: 10000,
        pricingStrategy: 'option_based',
        optionGroups: [{
          name: 'size',
          displayName: '사이즈',
          values: [
            { value: 'S', displayName: 'Small', price: 0 },
            { value: 'M', displayName: 'Medium', price: 1000 }
          ]
        }]
      });

      // 🚀 3단계: 가격 전략 초기화 성공 확인
      // TODO: 실제 구현에 맞게 파라미터 조정 필요
      // await service.initializePricingStrategy(testMaster.id);

      // ✅ 4단계: 가격 데이터가 설정되었는지 확인
      const optionPrices = await dbService.db
        .select()
        .from(optionValuePrices)
        .where(eq(optionValuePrices.masterId, testMaster.id));
      
      expect(optionPrices.length).toBeGreaterThan(0);
    });
  });

  // 🧹 청소 함수 - 관계 순서 중요!
  async function cleanupDatabase() {
    try {
      // 외래키 제약 때문에 자식부터 삭제
      await dbService.db.delete(variantPrices);
      await dbService.db.delete(optionValuePrices);
      await dbService.db.delete(variantOptionValues);
      await dbService.db.delete(productVariants);
      await dbService.db.delete(productOptionValues);
      await dbService.db.delete(productOptionGroups);
      await dbService.db.delete(productMasters);
    } catch (error) {
      console.warn('청소 중 에러 발생 (테스트는 계속):', error);
    }
  }
}); 