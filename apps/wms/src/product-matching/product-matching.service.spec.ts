// apps/wms/src/product-matching/product-matching.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProductMatchingService } from './product-matching.service';
import { SkuService } from '../sku/sku.service';
import { StockService } from '../stock/stock.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { ProductMatchingModule } from './product-matching.module';
import { WmsModule } from '../wms.module';
import { DbService } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { eq, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { WAREHOUSE_CONSTANTS } from '../warehouse/warehouse.constants';

describe('ProductMatchingService (Integration)', () => {
  let service: ProductMatchingService;
  let dbService: DbService<typeof wmsTables>;
  let skuService: SkuService;
  let stockService: StockService;
  let warehouseService: WarehouseService;

  // 테스트에서 사용할 UUID들을 미리 생성
  const testProductId = uuidv4();
  const testVariantId = uuidv4();
  // 실제 기본 창고 ID 사용
  const defaultWarehouseId = WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
    dbService = module.get<DbService<typeof wmsTables>>(DbService);
    skuService = module.get<SkuService>(SkuService);
    stockService = module.get<StockService>(StockService);
    warehouseService = module.get<WarehouseService>(WarehouseService);

    // 기본 창고를 명시적으로 생성 (onModuleInit이 테스트에서 실행되지 않을 수 있음)
    await dbService.db.insert(wmsTables.warehouses).values({
      id: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.id,
      name: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.name,
      type: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.type,
      location: WAREHOUSE_CONSTANTS.DEFAULT_DOMESTIC_WAREHOUSE.location,
    }).onConflictDoNothing();

    await dbService.db.insert(wmsTables.warehouses).values({
      id: WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.id,
      name: WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.name,
      type: WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.type,
      location: WAREHOUSE_CONSTANTS.DEFAULT_OVERSEAS_WAREHOUSE.location,
    }).onConflictDoNothing();
  });

  beforeEach(async () => {
    // 각 테스트 전에 관련 테이블들을 정리합니다
    // 순환 참조로 인해 개별 삭제가 어려우므로 TRUNCATE 사용
    await dbService.db.execute(sql`
      TRUNCATE TABLE 
        stock_reservations,
        stock_events,
        stocks,
        product_variant_sku_links,
        product_option_matchings,
        product_matchings,
        skus
      CASCADE
    `);
  });

  afterAll(async () => {
    // 테스트 완료 후 정리
    await dbService.db.execute(sql`
      TRUNCATE TABLE 
        stock_reservations,
        stock_events,
        stocks,
        product_variant_sku_links,
        product_option_matchings,
        product_matchings,
        skus
      CASCADE
    `);
  });

  it('서비스가 정의되어 있어야 한다', () => {
    expect(service).toBeDefined();
  });

  describe('수동 매칭 요청 처리', () => {
    it('variant에 대해 pending 상태의 매칭을 생성해야 한다', async () => {
      const variantId = uuidv4();
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // 데이터베이스에서 실제로 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      expect(createdMatching).toBeDefined();
      expect(createdMatching?.status).toBe('pending');
      expect(createdMatching?.priority).toBe('high');
      expect(createdMatching?.strategy).toBeNull();
      expect(createdMatching?.isResolved).toBe(false);
    });

    it('이미 매칭이 존재하면 건너뛰어야 한다', async () => {
      const variantId = uuidv4();
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      // 먼저 매칭을 생성
      await service.handleManualMatchingRequest(payload);

      // 기존 매칭 개수 확인
      const existingMatchings = await dbService.db.query.productMatchings.findMany({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });
      const initialCount = existingMatchings.length;

      // 다시 같은 요청을 보냄
      await service.handleManualMatchingRequest(payload);

      // 매칭 개수가 증가하지 않았는지 확인
      const finalMatchings = await dbService.db.query.productMatchings.findMany({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });
      expect(finalMatchings.length).toBe(initialCount);
    });
  });

  describe('자동 매칭 요청 처리', () => {
    it('재고 관리 대상 variant에 대해 SKU와 재고를 생성해야 한다', async () => {
      const variantId = uuidv4();
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      // 매칭이 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      expect(createdMatching).toBeDefined();
      expect(createdMatching?.status).toBe('matched');
      expect(createdMatching?.strategy).toBe('variant');
      expect(createdMatching?.isResolved).toBe(true);

      // SKU가 생성되었는지 확인
      const createdSku = await dbService.db.query.skus.findFirst({
        where: eq(wmsTables.skus.name, 'SKU-1'),
      });

      expect(createdSku).toBeDefined();

      // 재고가 생성되었는지 확인
      const createdStock = await dbService.db.query.stocks.findFirst({
        where: eq(wmsTables.stocks.skuId, createdSku!.id),
      });

      expect(createdStock).toBeDefined();
      expect(createdStock?.realQuantity).toBe(0);
    });

    it('재고 관리하지 않는 variant는 ignored 상태로 처리해야 한다', async () => {
      const variantId = uuidv4();
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '디지털 상품',
            inventoryManagement: false,
            components: [],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      // ignored 상태로 매칭이 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      expect(createdMatching).toBeDefined();
      expect(createdMatching?.status).toBe('ignored');
      expect(createdMatching?.strategy).toBe('void');
      expect(createdMatching?.isResolved).toBe(true);

      // SKU나 재고가 생성되지 않았는지 확인
      const createdSku = await dbService.db.query.skus.findFirst({
        where: eq(wmsTables.skus.name, 'SKU-1'),
      });

      expect(createdSku).toBeUndefined();
    });
  });

  describe('매칭 해소', () => {
    it('매칭 대기를 SKU와 연결하여 해소할 수 있어야 한다', async () => {
      const variantId = uuidv4();
      // 먼저 수동 매칭 요청을 생성
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // SKU를 생성
      const newSku = await service.createNewSkuForMatching(variantId, {
        name: '테스트 SKU',
        inventoryManagement: true,
      });

      // 매칭을 해소
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      await service.resolveMatchingPending(matching!.id, {
        skuIds: [newSku.id],
        ignore: false,
        strategy: 'variant'
      });

      // 매칭이 해소되었는지 확인
      const resolvedMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, matching!.id),
      });

      expect(resolvedMatching?.status).toBe('matched');
      expect(resolvedMatching?.strategy).toBe('variant');
      expect(resolvedMatching?.isResolved).toBe(true);
    });

    it('수동 매칭 시 수량을 지정할 수 있어야 한다', async () => {
      const variantId = uuidv4();
      // 수동 매칭 요청 생성
      const payload = {
        productId: testProductId,
        name: '세트 상품',
        variants: [
          {
            id: variantId,
            name: '선물 세트',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // 여러 SKU 생성
      const sku1 = await service.createNewSkuForMatching(variantId, {
        name: '상품 A',
        inventoryManagement: true,
      });

      const sku2 = await service.createNewSkuForMatching(variantId, {
        name: '상품 B',
        inventoryManagement: true,
      });

      // 매칭 ID 조회
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      // 수량을 지정하여 매칭 해소
      await service.resolveMatchingPending(matching!.id, {
        skuMappings: [
          { skuId: sku1.id, quantity: 2 }, // 상품 A 2개
          { skuId: sku2.id, quantity: 3 }, // 상품 B 3개
        ],
        ignore: false,
        strategy: 'variant'
      });

      // 매칭이 해소되었는지 확인
      const resolvedMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, matching!.id),
      });

      expect(resolvedMatching?.status).toBe('matched');

      // 링크 테이블에서 직접 조회
      const links = await dbService.db.query.productVariantSkuLinks.findMany({
        where: eq(wmsTables.productVariantSkuLinks.productMatchingId, matching!.id)
      });

      expect(links).toHaveLength(2);

      // 수량 확인
      const link1 = links.find(l => l.skuId === sku1.id);
      const link2 = links.find(l => l.skuId === sku2.id);
      expect(link1?.quantity).toBe(2);
      expect(link2?.quantity).toBe(3);
    });

    it('매칭 대기를 무시로 처리할 수 있어야 한다', async () => {
      const variantId = uuidv4();
      // 먼저 수동 매칭 요청을 생성
      const payload = {
        productId: testProductId,
        name: '테스트 상품',
        variants: [
          {
            id: variantId,
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // 매칭을 무시로 처리
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      await service.resolveMatchingPending(matching!.id, {
        skuIds: [],
        ignore: true,
      });

      // 매칭이 무시로 처리되었는지 확인
      const ignoredMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, matching!.id),
      });

      expect(ignoredMatching?.status).toBe('ignored');
      expect(ignoredMatching?.strategy).toBe('void');
      expect(ignoredMatching?.isResolved).toBe(true);
    });
  });

  describe('옵션별 매칭', () => {
    it('옵션별 매칭을 생성할 수 있어야 한다', async () => {
      const variantId = uuidv4();
      // 먼저 수동 매칭 요청을 생성
      const payload = {
        productId: testProductId,
        name: '컴퓨터',
        variants: [
          {
            id: variantId,
            name: '컴퓨터 세트',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // CPU와 RAM용 SKU 생성
      const cpuI7 = await service.createNewSkuForMatching(variantId, {
        name: 'Intel i7 CPU',
        inventoryManagement: true,
      });

      const ram16GB = await service.createNewSkuForMatching(variantId, {
        name: '16GB RAM',
        inventoryManagement: true,
      });

      // 매칭 ID 조회
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      // 옵션별 매칭 해소
      await service.resolveOptionMatching(matching!.id, [
        {
          optionName: 'CPU',
          optionValue: 'i7',
          skuId: cpuI7.id
        },
        {
          optionName: 'RAM',
          optionValue: '16GB',
          skuId: ram16GB.id
        }
      ]);

      // 매칭이 옵션별로 처리되었는지 확인
      const resolvedMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, matching!.id),
      });

      expect(resolvedMatching?.status).toBe('matched');
      expect(resolvedMatching?.strategy).toBe('option');
      expect(resolvedMatching?.isResolved).toBe(true);

      // 옵션 매칭이 생성되었는지 확인
      const optionMappings = await dbService.db.query.productOptionMatchings.findMany({
        where: eq(wmsTables.productOptionMatchings.productMatchingId, matching!.id),
      });

      expect(optionMappings).toHaveLength(2);
      expect(optionMappings.find(m => m.optionName === 'CPU' && m.optionValue === 'i7')).toBeDefined();
      expect(optionMappings.find(m => m.optionName === 'RAM' && m.optionValue === '16GB')).toBeDefined();
    });

    it('옵션 조합에 따른 SKU 목록을 조회할 수 있어야 한다', async () => {
      const variantId = uuidv4();
      // 매칭 생성 및 설정 (위 테스트와 동일한 과정)
      const payload = {
        productId: testProductId,
        name: '컴퓨터',
        variants: [
          {
            id: variantId,
            name: '컴퓨터 세트',
            inventoryManagement: true,
            components: [],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      const cpuI7 = await service.createNewSkuForMatching(variantId, {
        name: 'Intel i7 CPU',
        inventoryManagement: true,
      });

      const ram16GB = await service.createNewSkuForMatching(variantId, {
        name: '16GB RAM',
        inventoryManagement: true,
      });

      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      await service.resolveOptionMatching(matching!.id, [
        {
          optionName: 'CPU',
          optionValue: 'i7',
          skuId: cpuI7.id
        },
        {
          optionName: 'RAM',
          optionValue: '16GB',
          skuId: ram16GB.id
        }
      ]);

      // 특정 옵션 조합에 대한 SKU 조회
      const skuMappings = await service.getSkusForVariant(variantId, [
        { optionName: 'CPU', optionValue: 'i7' },
        { optionName: 'RAM', optionValue: '16GB' }
      ]);

      expect(skuMappings).toHaveLength(2);
      expect(skuMappings.find(m => m.skuId === cpuI7.id)).toBeDefined();
      expect(skuMappings.find(m => m.skuId === ram16GB.id)).toBeDefined();
    });
  });
});