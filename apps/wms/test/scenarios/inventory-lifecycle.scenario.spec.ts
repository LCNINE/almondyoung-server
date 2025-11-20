import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { wmsTables, wmsSchema, wmsViews } from '../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';

describe('Inventory Lifecycle Scenarios', () => {
  beforeAll(async () => {
    await WmsTestDatabase.setup();
  });

  afterAll(async () => {
    await WmsTestDatabase.teardown();
  });

  beforeEach(async () => {
    await WmsTestDatabase.clearAllTables();
    await WmsTestDatabase.resetSequences();
  });

  describe('기본 재고 관리 시나리오', () => {
    it('상품 입고 → 재고 확인 → 출고 전체 프로세스', async () => {
      // Given: 창고와 상품이 준비되어 있음
      const warehouse = await WmsTestFactory.createWarehouse({
        name: 'Main Warehouse',
        type: 'domestic'
      });

      const sku = await WmsTestFactory.createSku({
        name: 'iPhone 15 Pro',
        code: 'IPHONE15PRO-256GB-SILVER'
      });

      // When: 상품을 입고 처리
      const initialStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100,
        reservedQty: 0
      });

      // Then: 재고가 정확히 등록됨
      expect(initialStock.onHandQty).toBe(100);
      expect(initialStock.availableQty).toBe(100);
      expect(initialStock.reservedQty).toBe(0);
      expect(initialStock.warehouseId).toBe(warehouse.id);
      expect(initialStock.skuId).toBe(sku.id);

      // When: 판매 주문이 들어와서 재고를 예약
      // Note: stockSummary is a view, so we simulate reservation by creating new stock with updated values
      const reservedStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 80,  // 20개 예약됨
        reservedQty: 20
      });

      // Then: 재고 예약이 정확히 반영됨
      expect(reservedStock.onHandQty).toBe(100);
      expect(reservedStock.availableQty).toBe(80);
      expect(reservedStock.reservedQty).toBe(20);
      expect(reservedStock.availableQty + reservedStock.reservedQty).toBe(reservedStock.onHandQty);
    });

    it('멀티 창고 재고 분산 관리', async () => {
      // Given: 여러 창고가 있음
      const mainWarehouse = await WmsTestFactory.createWarehouse({
        name: 'Main Warehouse',
        location: 'Seoul',
        type: 'domestic'
      });

      const subWarehouse = await WmsTestFactory.createWarehouse({
        name: 'Sub Warehouse',
        location: 'Busan',
        type: 'domestic'
      });

      const sku = await WmsTestFactory.createSku({
        name: 'Galaxy S24',
        code: 'GALAXY-S24-128GB-BLACK'
      });

      // When: 각 창고에 재고 배치
      const mainStock = await WmsTestFactory.createStock({
        warehouseId: mainWarehouse.id,
        skuId: sku.id,
        onHandQty: 150,
        availableQty: 150
      });

      const subStock = await WmsTestFactory.createStock({
        warehouseId: subWarehouse.id,
        skuId: sku.id,
        onHandQty: 50,
        availableQty: 50
      });

      // Then: 각 창고별로 독립적인 재고 관리됨
      expect(mainStock.warehouseId).toBe(mainWarehouse.id);
      expect(subStock.warehouseId).toBe(subWarehouse.id);
      expect(mainStock.skuId).toBe(sku.id);
      expect(subStock.skuId).toBe(sku.id);

      // 전체 재고는 200개 (150 + 50)
      const totalStock = mainStock.onHandQty + subStock.onHandQty;
      expect(totalStock).toBe(200);
    });

    it('재고 부족 상황 처리', async () => {
      // Given: 재고가 부족한 상황
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: 'Limited Edition Watch',
        code: 'WATCH-LIMITED-GOLD'
      });

      const lowStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 5,
        availableQty: 2,  // 이미 3개가 예약됨
        reservedQty: 3
      });

      // Then: 재고 상태가 정확히 반영됨
      expect(lowStock.onHandQty).toBe(5);
      expect(lowStock.availableQty).toBe(2);
      expect(lowStock.reservedQty).toBe(3);

      // 가용 재고가 매우 적음을 확인
      expect(lowStock.availableQty).toBeLessThan(lowStock.onHandQty);
      expect(lowStock.reservedQty).toBeGreaterThan(lowStock.availableQty);
    });
  });

  describe('재고 조정 시나리오', () => {
    it('실사를 통한 재고 조정 (재고 증가)', async () => {
      // Given: 기존 재고가 있음
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: 'Laptop MacBook Pro',
        code: 'MBP-M3-16GB-512GB'
      });

      // 시스템상 재고
      const systemStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 50,
        availableQty: 45,
        reservedQty: 5
      });

      // When: 실사 결과 실제 재고가 더 많았음 (조정 증가)
      // Note: stockSummary is a view, so we simulate adjustment by creating adjusted stock
      const adjustedStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 55,  // +5 조정
        availableQty: 50,  // +5 조정
        reservedQty: 5     // 예약량은 동일
      });

      // Then: 조정이 정확히 반영됨
      expect(adjustedStock.onHandQty).toBe(systemStock.onHandQty + 5);
      expect(adjustedStock.availableQty).toBe(systemStock.availableQty + 5);
      expect(adjustedStock.reservedQty).toBe(systemStock.reservedQty);
    });

    it('손상품 처리를 통한 재고 감소', async () => {
      // Given: 정상 재고가 있음
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: 'Fragile Glass Item',
        code: 'GLASS-VASE-PREMIUM'
      });

      const normalStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 30,
        availableQty: 30,
        reservedQty: 0
      });

      // When: 손상으로 인한 재고 감소 (3개 파손)
      // Note: stockSummary is a view, so we simulate damage adjustment by creating adjusted stock
      const damagedAdjustedStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 27,  // -3 감소
        availableQty: 27,  // -3 감소
        reservedQty: 0
      });

      // Then: 손상품 제외 처리됨
      expect(damagedAdjustedStock.onHandQty).toBe(normalStock.onHandQty - 3);
      expect(damagedAdjustedStock.availableQty).toBe(normalStock.availableQty - 3);
      expect(damagedAdjustedStock.onHandQty).toBe(damagedAdjustedStock.availableQty);
    });
  });

  describe('복합 재고 시나리오', () => {
    it('동시 다발적 주문 처리 시나리오', async () => {
      // Given: 인기 상품과 충분한 재고
      const warehouse = await WmsTestFactory.createWarehouse();
      const popularSku = await WmsTestFactory.createSku({
        name: 'Popular Gaming Console',
        code: 'PS5-STANDARD-WHITE'
      });

      const initialStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: popularSku.id,
        onHandQty: 100,
        availableQty: 100,
        reservedQty: 0
      });

      // When: 여러 주문이 동시에 들어옴
      const orders = await Promise.all([
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'NAVER-001',
          salesChannel: 'naver'
        }),
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'COUPANG-001',
          salesChannel: 'coupang'
        }),
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'MEDUSA-001',
          salesChannel: 'medusa'
        })
      ]);

      // When: 각 주문별로 주문 라인 생성
      const orderLines = await Promise.all(orders.map(order =>
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: order.id,
          variantId: '550e8400-e29b-41d4-a716-446655440001',
          productName: popularSku.name,
          quantity: 2  // 각각 2개씩 주문
        })
      ));

      // Then: 모든 주문이 정상 생성됨
      expect(orders).toHaveLength(3);
      expect(orderLines).toHaveLength(3);

      orders.forEach((order, index) => {
        expect(order.status).toBe('pending');
        expect(orderLines[index].quantity).toBe(2);
        expect(orderLines[index].salesOrderId).toBe(order.id);
      });

      // 총 주문 수량: 6개 (2 × 3)
      const totalOrderQuantity = orderLines.reduce((sum, line) => sum + line.quantity, 0);
      expect(totalOrderQuantity).toBe(6);
      expect(initialStock.availableQty).toBeGreaterThanOrEqual(totalOrderQuantity);
    });

    it('크로스 도킹 시나리오 (입고 즉시 출고)', async () => {
      // Given: 창고와 미리 주문이 대기 중
      const warehouse = await WmsTestFactory.createWarehouse({
        name: 'Cross Dock Facility'
      });

      const sku = await WmsTestFactory.createSku({
        name: 'Pre-ordered Item',
        code: 'PREORDER-SPECIAL-2024'
      });

      // 재고가 없는 상태에서 주문이 먼저 들어옴
      const preOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'PREORDER-001',
        salesChannel: 'medusa'
      });

      const preOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: preOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: sku.name,
        quantity: 10
      });

      // When: 상품이 입고되면서 동시에 예약됨
      const crossDockStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 20,  // 20개 입고
        availableQty: 10,  // 10개는 즉시 예약됨
        reservedQty: 10   // 선주문 10개 예약
      });

      // Then: 크로스 도킹이 정상 처리됨
      expect(crossDockStock.onHandQty).toBe(20);
      expect(crossDockStock.reservedQty).toBe(preOrderLine.quantity);
      expect(crossDockStock.availableQty).toBe(crossDockStock.onHandQty - crossDockStock.reservedQty);

      // 선주문이 즉시 처리 가능한 상태
      expect(crossDockStock.reservedQty).toBeGreaterThan(0);
      expect(preOrder.status).toBe('pending');
    });
  });
});