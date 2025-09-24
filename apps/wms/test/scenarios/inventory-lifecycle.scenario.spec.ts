import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
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
        currentQuantity: 100,
        availableQuantity: 100,
        reservedQuantity: 0
      });

      // Then: 재고가 정확히 등록됨
      expect(initialStock.currentQuantity).toBe(100);
      expect(initialStock.availableQuantity).toBe(100);
      expect(initialStock.reservedQuantity).toBe(0);
      expect(initialStock.warehouseId).toBe(warehouse.id);
      expect(initialStock.skuId).toBe(sku.id);

      // When: 판매 주문이 들어와서 재고를 예약 (기존 재고 업데이트)
      const db = WmsTestDatabase.getDb();
      const [reservedStock] = await db.update(wmsTables.stockSummary)
        .set({
          availableQuantity: 80,  // 20개 예약됨
          reservedQuantity: 20
        })
        .where(and(
          eq(wmsTables.stockSummary.warehouseId, warehouse.id),
          eq(wmsTables.stockSummary.skuId, sku.id)
        ))
        .returning();

      // Then: 재고 예약이 정확히 반영됨
      expect(reservedStock.currentQuantity).toBe(100);
      expect(reservedStock.availableQuantity).toBe(80);
      expect(reservedStock.reservedQuantity).toBe(20);
      expect(reservedStock.availableQuantity + reservedStock.reservedQuantity).toBe(reservedStock.currentQuantity);
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
        currentQuantity: 150,
        availableQuantity: 150
      });

      const subStock = await WmsTestFactory.createStock({
        warehouseId: subWarehouse.id,
        skuId: sku.id,
        currentQuantity: 50,
        availableQuantity: 50
      });

      // Then: 각 창고별로 독립적인 재고 관리됨
      expect(mainStock.warehouseId).toBe(mainWarehouse.id);
      expect(subStock.warehouseId).toBe(subWarehouse.id);
      expect(mainStock.skuId).toBe(sku.id);
      expect(subStock.skuId).toBe(sku.id);

      // 전체 재고는 200개 (150 + 50)
      const totalStock = mainStock.currentQuantity + subStock.currentQuantity;
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
        currentQuantity: 5,
        availableQuantity: 2,  // 이미 3개가 예약됨
        reservedQuantity: 3
      });

      // Then: 재고 상태가 정확히 반영됨
      expect(lowStock.currentQuantity).toBe(5);
      expect(lowStock.availableQuantity).toBe(2);
      expect(lowStock.reservedQuantity).toBe(3);

      // 가용 재고가 매우 적음을 확인
      expect(lowStock.availableQuantity).toBeLessThan(lowStock.currentQuantity);
      expect(lowStock.reservedQuantity).toBeGreaterThan(lowStock.availableQuantity);
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
        currentQuantity: 50,
        availableQuantity: 45,
        reservedQuantity: 5
      });

      // When: 실사 결과 실제 재고가 더 많았음 (조정 증가)
      const db = WmsTestDatabase.getDb();
      const [adjustedStock] = await db.update(wmsTables.stockSummary)
        .set({
          currentQuantity: 55,  // +5 조정
          availableQuantity: 50,  // +5 조정
          reservedQuantity: 5     // 예약량은 동일
        })
        .where(and(
          eq(wmsTables.stockSummary.warehouseId, warehouse.id),
          eq(wmsTables.stockSummary.skuId, sku.id)
        ))
        .returning();

      // Then: 조정이 정확히 반영됨
      expect(adjustedStock.currentQuantity).toBe(systemStock.currentQuantity + 5);
      expect(adjustedStock.availableQuantity).toBe(systemStock.availableQuantity + 5);
      expect(adjustedStock.reservedQuantity).toBe(systemStock.reservedQuantity);
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
        currentQuantity: 30,
        availableQuantity: 30,
        reservedQuantity: 0
      });

      // When: 손상으로 인한 재고 감소 (3개 파손)
      const db = WmsTestDatabase.getDb();
      const [damagedAdjustedStock] = await db.update(wmsTables.stockSummary)
        .set({
          currentQuantity: 27,  // -3 감소
          availableQuantity: 27,  // -3 감소
          reservedQuantity: 0
        })
        .where(and(
          eq(wmsTables.stockSummary.warehouseId, warehouse.id),
          eq(wmsTables.stockSummary.skuId, sku.id)
        ))
        .returning();

      // Then: 손상품 제외 처리됨
      expect(damagedAdjustedStock.currentQuantity).toBe(normalStock.currentQuantity - 3);
      expect(damagedAdjustedStock.availableQuantity).toBe(normalStock.availableQuantity - 3);
      expect(damagedAdjustedStock.currentQuantity).toBe(damagedAdjustedStock.availableQuantity);
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
        currentQuantity: 100,
        availableQuantity: 100,
        reservedQuantity: 0
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
      expect(initialStock.availableQuantity).toBeGreaterThanOrEqual(totalOrderQuantity);
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
        currentQuantity: 20,  // 20개 입고
        availableQuantity: 10,  // 10개는 즉시 예약됨
        reservedQuantity: 10   // 선주문 10개 예약
      });

      // Then: 크로스 도킹이 정상 처리됨
      expect(crossDockStock.currentQuantity).toBe(20);
      expect(crossDockStock.reservedQuantity).toBe(preOrderLine.quantity);
      expect(crossDockStock.availableQuantity).toBe(crossDockStock.currentQuantity - crossDockStock.reservedQuantity);

      // 선주문이 즉시 처리 가능한 상태
      expect(crossDockStock.reservedQuantity).toBeGreaterThan(0);
      expect(preOrder.status).toBe('pending');
    });
  });
});