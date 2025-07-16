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
import { eq, and } from 'drizzle-orm';

describe('ProductMatchingService (Integration)', () => {
  let service: ProductMatchingService;
  let dbService: DbService<typeof wmsTables>;
  let skuService: SkuService;
  let stockService: StockService;
  let warehouseService: WarehouseService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [WmsModule],
    }).compile();

    service = module.get<ProductMatchingService>(ProductMatchingService);
    dbService = module.get<DbService<typeof wmsTables>>(DbService);
    skuService = module.get<SkuService>(SkuService);
    stockService = module.get<StockService>(StockService);
    warehouseService = module.get<WarehouseService>(WarehouseService);
  });

  beforeEach(async () => {
    // 각 테스트 전에 관련 테이블들을 정리합니다
    await dbService.db.transaction(async (tx) => {
      await tx.delete(wmsTables.productVariantSkuLinks);
      await tx.delete(wmsTables.productMatchings);
      await tx.delete(wmsTables.stocks);
      await tx.delete(wmsTables.skus);
      await tx.delete(wmsTables.warehouses);
    });
  });

  afterAll(async () => {
    // 테스트 완료 후 정리
    await dbService.db.transaction(async (tx) => {
      await tx.delete(wmsTables.productVariantSkuLinks);
      await tx.delete(wmsTables.productMatchings);
      await tx.delete(wmsTables.stocks);
      await tx.delete(wmsTables.skus);
      await tx.delete(wmsTables.warehouses);
    });
  });

  it('서비스가 정의되어 있어야 한다', () => {
    expect(service).toBeDefined();
  });

  describe('수동 매칭 요청 처리', () => {
    it('variant에 대해 pending 상태의 매칭을 생성해야 한다', async () => {
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // 데이터베이스에서 실제로 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
      });

      expect(createdMatching).toBeDefined();
      expect(createdMatching?.status).toBe('pending');
      expect(createdMatching?.priority).toBe('high');
      expect(createdMatching?.isResolved).toBe(false);
    });

    it('이미 매칭이 존재하면 건너뛰어야 한다', async () => {
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
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
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
      });
      const initialCount = existingMatchings.length;

      // 다시 같은 요청을 보냄
      await service.handleManualMatchingRequest(payload);

      // 매칭 개수가 증가하지 않았는지 확인
      const finalMatchings = await dbService.db.query.productMatchings.findMany({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
      });
      expect(finalMatchings.length).toBe(initialCount);
    });
  });

  describe('자동 매칭 요청 처리', () => {
    it('재고 관리 대상 variant에 대해 SKU와 재고를 생성해야 한다', async () => {
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      // 매칭이 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
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
        where: and(
          eq(wmsTables.stocks.skuId, createdSku!.id),
          eq(wmsTables.stocks.variantId, 'variant-1')
        ),
      });

      expect(createdStock).toBeDefined();
      expect(createdStock?.quantity).toBe(0);
    });

    it('재고 관리하지 않는 variant는 ignored 상태로 처리해야 한다', async () => {
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
            name: '디지털 상품',
            inventoryManagement: false,
            components: [],
          },
        ],
      };

      await service.handleAutomaticMatchingRequest(payload);

      // ignored 상태로 매칭이 생성되었는지 확인
      const createdMatching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
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
      // 먼저 수동 매칭 요청을 생성
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // SKU를 생성
      const newSku = await service.createNewSkuForMatching('variant-1', {
        name: '테스트 SKU',
        inventoryManagement: true,
      });

      // 매칭을 해소
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
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
      // 먼저 수동 매칭 요청을 생성
      const payload = {
        productId: 'product-1',
        name: '테스트 상품',
        variants: [
          {
            id: 'variant-1',
            name: '테스트 변형',
            inventoryManagement: true,
            components: [{ skuName: 'SKU-1' }],
          },
        ],
      };

      await service.handleManualMatchingRequest(payload);

      // 매칭을 무시로 처리
      const matching = await dbService.db.query.productMatchings.findFirst({
        where: eq(wmsTables.productMatchings.variantId, 'variant-1'),
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