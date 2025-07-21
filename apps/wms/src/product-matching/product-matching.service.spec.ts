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

      // WarehouseService의 getDefaultWarehouseId를 모킹할 필요 없음
      // 실제 기본 창고 ID를 사용

      await service.handleAutomaticMatchingRequest(payload);

      // 매칭이 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, variantId),
      });

      expect(createdMatching).toBeDefined();
      expect(createdMatching?.status).toBe('matched');
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

      // WarehouseService의 getDefaultWarehouseId를 모킹할 필요 없음
      // 실제 기본 창고 ID를 사용

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
      });

      // 매칭이 해소되었는지 확인
      const resolvedMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.id, matching!.id),
      });

      expect(resolvedMatching?.status).toBe('matched');
      expect(resolvedMatching?.isResolved).toBe(true);
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
      expect(ignoredMatching?.isResolved).toBe(true);
    });
  });
});