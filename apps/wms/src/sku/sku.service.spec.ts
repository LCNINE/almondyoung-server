// apps/wms/src/sku/sku.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { SkuService } from './sku.service';
import { WmsModule } from '../wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { SkuCreationSource } from './dto/create-sku.dto';
import { WAREHOUSE_CONSTANTS } from '../warehouse/warehouse.constants';

describe('SkuService (Integration)', () => {
  let service: SkuService;
  let dbService: DbService<typeof wmsTables>;

  // 테스트에서 사용할 UUID들
  const testDeliveryProfileId = uuidv4();
  const testSupplierId = uuidv4();
  const testCategoryId = uuidv4();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    service = module.get<SkuService>(SkuService);
    dbService = module.get<DbService<typeof wmsTables>>(DbService);

    // 기본 창고 생성
    await dbService.db.insert(wmsTables.warehouses).values({
      id: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id,
      name: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.name,
      type: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.type,
      location: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.location,
    }).onConflictDoNothing();

    // 테스트용 마스터 데이터 생성
    await dbService.db.insert(wmsTables.deliveryProfiles).values({
      id: testDeliveryProfileId,
      name: '테스트 배송 프로필',
      sourceType: 'direct',
      avgDeliveryDays: 2,
    }).onConflictDoNothing();

    await dbService.db.insert(wmsTables.suppliers).values({
      id: testSupplierId,
      name: '테스트 공급사',
      contactInfo: { phone: '010-1234-5678', email: 'test@supplier.com' },
    }).onConflictDoNothing();

    await dbService.db.insert(wmsTables.categories).values({
      id: testCategoryId,
      name: '테스트 카테고리',
    }).onConflictDoNothing();
  });

  beforeEach(async () => {
    // 각 테스트 전에 관련 테이블들을 정리
    await dbService.db.execute(sql`
      TRUNCATE TABLE 
        sku_barcodes,
        sku_categories,
        sku_suppliers,
        stock_reservations,
        stock_events,
        stocks,
        product_variant_sku_links,
        product_matchings,
        skus
      CASCADE
    `);
  });

  afterAll(async () => {
    // 테스트 완료 후 정리
    await dbService.db.execute(sql`
      TRUNCATE TABLE 
        sku_barcodes,
        sku_categories,
        sku_suppliers,
        stock_reservations,
        stock_events,
        stocks,
        product_variant_sku_links,
        product_matchings,
        skus
      CASCADE
    `);
  });

  it('서비스가 정의되어 있어야 한다', () => {
    expect(service).toBeDefined();
  });

  describe('SKU 생성', () => {
    it('수동 매칭으로 SKU를 생성해야 한다', async () => {
      const skuData = {
        name: '테스트 SKU',
        source: SkuCreationSource.MANUAL_MATCHING,
        inventoryManagement: true,
        deliveryProfileId: testDeliveryProfileId,
        alwaysSellableZeroStock: false,
        sale1m: 100,
        sale3m: 300,
      };

      const newSku = await dbService.db.transaction(async (tx) => {
        return service._createSkuInternal(skuData, tx);
      });

      expect(newSku).toBeDefined();
      expect(newSku.name).toBe('테스트 SKU');
      expect(newSku.code).toMatch(/^P\d{5}[A-Z]{3}$/); // P + 5자리 숫자 + 3자리 대문자
      expect(newSku.inventoryManagement).toBe(true);
      expect(newSku.preStockSellable).toBe(true); // inventoryManagement가 true이면 preStockSellable도 true
      expect(newSku.defaultBarcode).toBeDefined();
      expect(newSku.defaultBarcode).toMatch(/^SKU_B_/);
    });

    it('자동 매칭으로 SKU를 생성해야 한다', async () => {
      const skuData = {
        name: '무시될 이름',
        source: SkuCreationSource.AUTO_MATCHING,
        productName: '아몬드영 초콜릿',
        variantName: '다크 100g',
        inventoryManagement: true,
      };

      const newSku = await dbService.db.transaction(async (tx) => {
        return service._createSkuInternal(skuData, tx);
      });

      expect(newSku).toBeDefined();
      expect(newSku.name).toBe('아몬드영 초콜릿 - 다크 100g');
      expect(newSku.inventoryManagement).toBe(true);
    });

    it('SKU 생성 시 기본 바코드가 자동 생성되어야 한다', async () => {
      const skuData = {
        name: '바코드 테스트 SKU',
        inventoryManagement: false,
      };

      const newSku = await dbService.db.transaction(async (tx) => {
        return service._createSkuInternal(skuData, tx);
      });

      // 바코드가 실제로 생성되었는지 확인
      const createdBarcode = await dbService.db.query.skuBarcodes.findFirst({
        where: eq(wmsTables.skuBarcodes.skuId, newSku.id),
      });

      expect(createdBarcode).toBeDefined();
      expect(createdBarcode?.barcode).toBe(newSku.defaultBarcode);
      expect(createdBarcode?.barcodeType).toBe('standard');
    });

    it('트랜잭션 내에서 SKU를 생성할 수 있어야 한다', async () => {
      await dbService.db.transaction(async (tx) => {
        const skuData = {
          name: '트랜잭션 테스트 SKU',
          inventoryManagement: true,
        };

        const newSku = await service._createSkuInternal(skuData, tx);
        expect(newSku).toBeDefined();

        // 트랜잭션 내에서 생성된 SKU 확인
        const foundSku = await tx.query.skus.findFirst({
          where: eq(wmsTables.skus.id, newSku.id),
        });
        expect(foundSku).toBeDefined();
      });
    });
  });

  describe('SKU 업데이트', () => {
    let testSkuId: string;

    beforeEach(async () => {
      // 테스트용 SKU 생성
      await dbService.db.transaction(async (tx) => {
        const newSku = await service._createSkuInternal({
          name: '업데이트 테스트 SKU',
          inventoryManagement: true,
        }, tx);
        testSkuId = newSku.id;
      });
    });

    it('SKU 정보를 업데이트할 수 있어야 한다', async () => {
      const updateData = {
        name: '업데이트된 SKU 이름',
        alwaysSellableZeroStock: true,
        sale1m: 200,
        sale3m: 600,
      };

      const updatedSku = await dbService.db.transaction(async (tx) => {
        return service._updateSkuInternal(testSkuId, updateData, tx);
      });

      expect(updatedSku.name).toBe('업데이트된 SKU 이름');
      expect(updatedSku.alwaysSellableZeroStock).toBe(true);
      expect(updatedSku.sale1m).toBe(200);
      expect(updatedSku.sale3m).toBe(600);
    });

    it('존재하지 않는 SKU 업데이트 시 오류가 발생해야 한다', async () => {
      const fakeSkuId = uuidv4();

      await expect(
        dbService.db.transaction(async (tx) => {
          return service._updateSkuInternal(fakeSkuId, { name: '실패할 업데이트' }, tx);
        })
      ).rejects.toThrow('SKU with ID');
    });

    it('preStockSellable 상태를 업데이트할 수 있어야 한다', async () => {
      // 초기 상태 확인
      const initialSku = await service.findSkuById(testSkuId);
      expect(initialSku?.preStockSellable).toBe(true);

      // false로 업데이트
      const updatedSku = await dbService.db.transaction(async (tx) => {
        return service._updatePreStockSellableInternal(testSkuId, false, tx);
      });
      expect(updatedSku.preStockSellable).toBe(false);

      // 다시 true로 업데이트
      const reUpdatedSku = await dbService.db.transaction(async (tx) => {
        return service._updatePreStockSellableInternal(testSkuId, true, tx);
      });
      expect(reUpdatedSku.preStockSellable).toBe(true);
    });
  });

  describe('SKU 조회', () => {
    let testSku1Id: string;
    let testSku2Id: string;

    beforeEach(async () => {
      // 테스트용 SKU들 생성
      await dbService.db.transaction(async (tx) => {
        const sku1 = await service._createSkuInternal({
          name: '초콜릿 바',
          inventoryManagement: true,
        }, tx);
        testSku1Id = sku1.id;

        const sku2 = await service._createSkuInternal({
          name: '아몬드 초콜릿',
          inventoryManagement: false,
        }, tx);
        testSku2Id = sku2.id;

        // 공급사 연결
        await tx.insert(wmsTables.skuSuppliers).values({
          skuId: testSku1Id,
          supplierId: testSupplierId,
        });

        // 추가 바코드 생성
        await tx.insert(wmsTables.skuBarcodes).values({
          skuId: testSku1Id,
          barcode: 'BARCODE123456',
          barcodeType: 'standard',
        });
      });
    });

    it('ID로 SKU를 조회할 수 있어야 한다', async () => {
      const foundSku = await service.findSkuById(testSku1Id);

      expect(foundSku).toBeDefined();
      expect(foundSku?.id).toBe(testSku1Id);
      expect(foundSku?.name).toBe('초콜릿 바');
    });

    it('트랜잭션 내에서 SKU를 조회할 수 있어야 한다', async () => {
      await dbService.db.transaction(async (tx) => {
        const foundSku = await service.findSkuById(testSku1Id, tx);
        expect(foundSku).toBeDefined();
        expect(foundSku?.id).toBe(testSku1Id);
      });
    });

    it('이름으로 SKU를 검색할 수 있어야 한다', async () => {
      const results = await service.searchSkus({ name: '초콜릿' });

      expect(results).toHaveLength(2);
      expect(results.some((sku: any) => sku.name === '초콜릿 바')).toBe(true);
      expect(results.some((sku: any) => sku.name === '아몬드 초콜릿')).toBe(true);
    });

    it('바코드로 SKU를 검색할 수 있어야 한다', async () => {
      const results = await service.searchSkus({ barcode: 'BARCODE123456' });

      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe(testSku1Id);
      expect((results[0] as any).barcodes).toContain('BARCODE123456');
    });

    it('공급사 이름으로 SKU를 검색할 수 있어야 한다', async () => {
      const results = await service.searchSkus({ supplierName: '테스트' });

      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe(testSku1Id);
      expect((results[0] as any).suppliers).toContain('테스트 공급사');
    });

    it('여러 조건으로 SKU를 검색할 수 있어야 한다', async () => {
      const results = await service.searchSkus({
        name: '초콜릿',
        supplierName: '테스트'
      });

      expect(results).toHaveLength(1);
      expect((results[0] as any).id).toBe(testSku1Id);
      expect((results[0] as any).name).toBe('초콜릿 바');
    });

    it('검색 결과에 바코드와 공급사 정보가 집계되어야 한다', async () => {
      // 추가 바코드 생성
      await dbService.db.insert(wmsTables.skuBarcodes).values({
        skuId: testSku1Id,
        barcode: 'BARCODE789012',
        barcodeType: 'standard',
      });

      const results = await service.searchSkus({ id: testSku1Id });

      expect(results).toHaveLength(1);
      expect((results[0] as any).barcodes).toHaveLength(2);
      expect((results[0] as any).barcodes).toContain('BARCODE123456');
      expect((results[0] as any).barcodes).toContain('BARCODE789012');
      expect((results[0] as any).suppliers).toContain('테스트 공급사');
    });
  });

  describe('SKU 코드 생성', () => {
    it('고유한 SKU 코드를 생성해야 한다', async () => {
      const codes = new Set<string>();

      // 100개의 SKU를 생성하여 코드 중복이 없는지 확인
      for (let i = 0; i < 100; i++) {
        const sku = await service._createSkuInternal({
          name: `테스트 SKU ${i}`,
          inventoryManagement: false,
        });
        codes.add(sku.code);
      }

      // 모든 코드가 고유한지 확인
      expect(codes.size).toBe(100);
    });

    it('SKU 코드가 올바른 형식을 가져야 한다', async () => {
      const sku = await service._createSkuInternal({
        name: '형식 테스트 SKU',
        inventoryManagement: false,
      });

      // P + 5자리 숫자 + 3자리 대문자
      expect(sku.code).toMatch(/^P\d{5}[A-Z]{3}$/);
    });
  });
});