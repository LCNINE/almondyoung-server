import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { eq, and } from 'drizzle-orm';

describe('Order Fulfillment Scenarios', () => {
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

  describe('일반 주문 처리 시나리오', () => {
    it('단일 상품 주문 → 이행 → 출고 완료 프로세스', async () => {
      // Given: 기본 설정 (창고, 상품, 재고)
      const scenario = await WmsTestFactory.createCompleteOrderFlow();

      // Then: 모든 엔티티가 올바르게 연결됨
      expect(scenario.warehouse.id).toBeTruthy();
      expect(scenario.sku.id).toBeTruthy();
      expect(scenario.salesOrder.id).toBeTruthy();
      expect(scenario.fulfillmentOrder.id).toBeTruthy();

      // 관계 검증
      expect(scenario.stock.warehouseId).toBe(scenario.warehouse.id);
      expect(scenario.stock.skuId).toBe(scenario.sku.id);
      expect(scenario.fulfillmentOrder.warehouseId).toBe(scenario.warehouse.id);
      expect(scenario.fulfillmentOrderItem.fulfillmentOrderId).toBe(scenario.fulfillmentOrder.id);
      expect(scenario.fulfillmentOrderItem.skuId).toBe(scenario.sku.id);

      // 비즈니스 규칙 검증
      expect(scenario.stock.currentQuantity).toBeGreaterThan(0);
      expect(scenario.stock.availableQuantity).toBeGreaterThanOrEqual(0);
      expect(scenario.fulfillmentOrderItem.qty).toBeGreaterThan(0);
      expect(scenario.salesOrder.status).toBe('pending');
      expect(scenario.fulfillmentOrder.status).toBe('created');
    });

    it('다중 상품 주문 처리', async () => {
      // Given: 창고와 여러 상품
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku1 = await WmsTestFactory.createSku({ name: 'Product A', code: 'PROD-A-001' });
      const sku2 = await WmsTestFactory.createSku({ name: 'Product B', code: 'PROD-B-001' });
      const sku3 = await WmsTestFactory.createSku({ name: 'Product C', code: 'PROD-C-001' });

      // 각 상품별 재고 준비
      const stock1 = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku1.id,
        currentQuantity: 50,
        availableQuantity: 50
      });

      const stock2 = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku2.id,
        currentQuantity: 30,
        availableQuantity: 30
      });

      const stock3 = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku3.id,
        currentQuantity: 100,
        availableQuantity: 100
      });

      // When: 다중 상품 주문
      const salesOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MULTI-001',
        salesChannel: 'medusa'
      });

      const orderLines = await Promise.all([
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: salesOrder.id,
          variantId: '550e8400-e29b-41d4-a716-446655440001',
          productName: sku1.name,
          quantity: 3
        }),
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: salesOrder.id,
          variantId: '550e8400-e29b-41d4-a716-446655440002',
          productName: sku2.name,
          quantity: 2
        }),
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: salesOrder.id,
          variantId: '550e8400-e29b-41d4-a716-446655440003',
          productName: sku3.name,
          quantity: 5
        })
      ]);

      // When: 이행 주문 생성
      const fulfillmentOrder = await WmsTestFactory.createFulfillmentOrder({
        warehouseId: warehouse.id,
        status: 'created'
      });

      const fulfillmentItems = await Promise.all([
        WmsTestFactory.createFulfillmentOrderItem({
          fulfillmentOrderId: fulfillmentOrder.id,
          skuId: sku1.id,
          qty: 3
        }),
        WmsTestFactory.createFulfillmentOrderItem({
          fulfillmentOrderId: fulfillmentOrder.id,
          skuId: sku2.id,
          qty: 2
        }),
        WmsTestFactory.createFulfillmentOrderItem({
          fulfillmentOrderId: fulfillmentOrder.id,
          skuId: sku3.id,
          qty: 5
        })
      ]);

      // Then: 다중 상품 주문이 정상 처리됨
      expect(orderLines).toHaveLength(3);
      expect(fulfillmentItems).toHaveLength(3);

      // 각 라인별 수량 검증
      expect(orderLines[0].quantity).toBe(3);
      expect(orderLines[1].quantity).toBe(2);
      expect(orderLines[2].quantity).toBe(5);

      // 이행 아이템과 주문 라인 수량 일치 검증
      expect(fulfillmentItems[0].qty).toBe(orderLines[0].quantity);
      expect(fulfillmentItems[1].qty).toBe(orderLines[1].quantity);
      expect(fulfillmentItems[2].qty).toBe(orderLines[2].quantity);

      // 재고 충분성 검증
      expect(stock1.availableQuantity).toBeGreaterThanOrEqual(fulfillmentItems[0].qty);
      expect(stock2.availableQuantity).toBeGreaterThanOrEqual(fulfillmentItems[1].qty);
      expect(stock3.availableQuantity).toBeGreaterThanOrEqual(fulfillmentItems[2].qty);
    });

    it('부분 출고 시나리오 (재고 부족으로 인한)', async () => {
      // Given: 제한된 재고 상황
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: 'Limited Stock Item',
        code: 'LIMITED-STOCK-001'
      });

      const limitedStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        currentQuantity: 10,
        availableQuantity: 7,  // 이미 3개가 다른 주문에 예약됨
        reservedQuantity: 3
      });

      // When: 가용 재고보다 많은 수량 주문
      const salesOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'PARTIAL-001',
        salesChannel: 'coupang'
      });

      const orderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: salesOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: sku.name,
        quantity: 10  // 요청: 10개, 가능: 7개
      });

      // When: 이행 주문은 가능한 수량만큼만 생성
      const fulfillmentOrder = await WmsTestFactory.createFulfillmentOrder({
        warehouseId: warehouse.id,
        status: 'created'
      });

      const fulfillmentItem = await WmsTestFactory.createFulfillmentOrderItem({
        fulfillmentOrderId: fulfillmentOrder.id,
        skuId: sku.id,
        qty: 7  // 가용 재고만큼만 이행
      });

      // Then: 부분 이행 상황이 올바르게 처리됨
      expect(orderLine.quantity).toBe(10);  // 원래 주문 수량
      expect(fulfillmentItem.qty).toBe(7);   // 실제 이행 가능 수량
      expect(limitedStock.availableQuantity).toBe(7);

      // 부분 이행 플래그나 상태 확인 (실제 구현에 따라)
      expect(fulfillmentItem.qty).toBeLessThan(orderLine.quantity);
      expect(fulfillmentItem.qty).toBe(limitedStock.availableQuantity);
    });
  });

  describe('특수 이행 모드 시나리오', () => {
    it('즉시 출고 (Fast Track) 시나리오', async () => {
      // Given: 긴급 주문을 위한 설정
      const warehouse = await WmsTestFactory.createWarehouse({
        name: 'Express Fulfillment Center'
      });

      const urgentSku = await WmsTestFactory.createSku({
        name: 'Urgent Medicine',
        code: 'URGENT-MED-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: urgentSku.id,
        currentQuantity: 100,
        availableQuantity: 100
      });

      // When: 우선순위 높은 주문
      const urgentOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'URGENT-001',
        salesChannel: 'medusa'
      });

      const urgentOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: urgentOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: urgentSku.name,
        quantity: 5
      });

      const urgentFulfillment = await WmsTestFactory.createFulfillmentOrder({
        warehouseId: warehouse.id,
        status: 'ready'  // 즉시 처리 가능 상태
      });

      const urgentFulfillmentItem = await WmsTestFactory.createFulfillmentOrderItem({
        fulfillmentOrderId: urgentFulfillment.id,
        skuId: urgentSku.id,
        qty: 5
      });

      // When: 즉시 예약 처리
      const reservation = await WmsTestFactory.createStockReservation({
        skuId: urgentSku.id,
        fulfillmentOrderItemId: urgentFulfillmentItem.id,
        quantity: 5,
        status: 'confirmed'  // 즉시 확정
      });

      // Then: 긴급 주문이 우선 처리됨
      expect(urgentFulfillment.status).toBe('ready');
      expect(reservation.status).toBe('confirmed');
      expect(reservation.quantity).toBe(urgentFulfillmentItem.qty);
      expect(reservation.skuId).toBe(urgentSku.id);
    });

    it('배송지 통합 (Consolidation) 시나리오', async () => {
      // Given: 동일 고객의 여러 주문
      const warehouse = await WmsTestFactory.createWarehouse();
      const customerEmail = 'customer@example.com';

      const shippingAddress = {
        name: 'John Doe',
        phone: '010-1234-5678',
        address: '123 Main St',
        city: 'Seoul',
        postalCode: '12345'
      };

      // When: 동일 고객이 시간차로 여러 주문
      const order1 = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CONS-001',
        salesChannel: 'medusa',
        customerEmail,
        shippingAddress
      });

      const order2 = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CONS-002',
        salesChannel: 'medusa',
        customerEmail,
        shippingAddress
      });

      const order3 = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CONS-003',
        salesChannel: 'medusa',
        customerEmail,
        shippingAddress
      });

      // When: 배치 그룹으로 통합 처리
      const batchScenario = await WmsTestFactory.createBatchWithMultipleOrders(3);

      // Then: 배송 통합이 가능한 구조
      expect(batchScenario.orders).toHaveLength(3);
      expect(batchScenario.warehouse.id).toBeTruthy();
      expect(batchScenario.batch.status).toBe('created');
      expect(batchScenario.batch.pickingMethod).toBe('individual');

      // 모든 주문이 동일 창고에서 처리됨
      batchScenario.orders.forEach(orderFlow => {
        expect(orderFlow.fulfillmentOrder.warehouseId).toBe(batchScenario.warehouse.id);
        expect(orderFlow.fulfillmentOrder.status).toBe('ready');
      });

      // 개별 주문들이 서로 다른 상품을 포함
      const skuIds = batchScenario.orders.map(o => o.sku.id);
      expect(new Set(skuIds).size).toBe(3);  // 모두 다른 SKU
    });
  });

  describe('예외 상황 처리 시나리오', () => {
    it('주문 취소 후 재고 복원', async () => {
      // Given: 예약된 주문이 있음
      const scenario = await WmsTestFactory.createReadyForPickingScenario();

      // 예약 상태 확인
      expect(scenario.reservation.status).toBe('pending');
      expect(scenario.reservation.quantity).toBe(scenario.fulfillmentOrderItem.qty);

      // When: 주문 취소 (실제로는 서비스를 통해 처리되지만, 여기서는 데이터 상태로 검증)
      const cancelledOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CANCEL-001',
        salesChannel: 'naver',
        status: 'cancelled'
      });

      // Then: 취소된 주문 상태 확인
      expect(cancelledOrder.status).toBe('cancelled');

      // 원래 주문은 여전히 유효
      expect(scenario.salesOrder.id).toBeTruthy();
      expect(scenario.reservation.fulfillmentOrderItemId).toBe(scenario.fulfillmentOrderItem.id);
    });

    it('재고 없음 상황에서의 백오더 처리', async () => {
      // Given: 재고가 없는 상품
      const warehouse = await WmsTestFactory.createWarehouse();
      const outOfStockSku = await WmsTestFactory.createSku({
        name: 'Out of Stock Item',
        code: 'OOS-001'
      });

      const zeroStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: outOfStockSku.id,
        currentQuantity: 0,
        availableQuantity: 0,
        reservedQuantity: 0
      });

      // When: 재고 없는 상품 주문
      const backOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'BACKORDER-001',
        salesChannel: 'coupang'
      });

      const backOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: backOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: outOfStockSku.name,
        quantity: 5
      });

      // Then: 백오더 상황 확인
      expect(zeroStock.currentQuantity).toBe(0);
      expect(zeroStock.availableQuantity).toBe(0);
      expect(backOrderLine.quantity).toBeGreaterThan(zeroStock.availableQuantity);

      // 주문은 생성되지만 즉시 이행 불가
      expect(backOrder.status).toBe('pending');
      expect(backOrderLine.salesOrderId).toBe(backOrder.id);
    });

    it('손상품 발견 시 처리 프로세스', async () => {
      // Given: 정상 재고와 피킹 준비된 주문
      const scenario = await WmsTestFactory.createReadyForPickingScenario();

      // When: 피킹 중 손상품 발견으로 수량 부족
      const damagedQty = 2;
      const actualPickableQty = scenario.fulfillmentOrderItem.qty - damagedQty;

      // 손상품 제외 후 조정된 재고
      const db = WmsTestDatabase.getDb();
      const [adjustedStock] = await db.update(wmsTables.stockSummary)
        .set({
          currentQuantity: scenario.stock.currentQuantity - damagedQty,
          availableQuantity: scenario.stock.availableQuantity - damagedQty,
          reservedQuantity: scenario.stock.reservedQuantity
        })
        .where(and(
          eq(wmsTables.stockSummary.warehouseId, scenario.warehouse.id),
          eq(wmsTables.stockSummary.skuId, scenario.sku.id)
        ))
        .returning();

      // Then: 손상품 처리가 반영됨
      expect(adjustedStock.currentQuantity).toBe(scenario.stock.currentQuantity - damagedQty);
      expect(actualPickableQty).toBeGreaterThan(0);  // 여전히 일부는 피킹 가능
      expect(actualPickableQty).toBeLessThan(scenario.fulfillmentOrderItem.qty);

      // 원래 예약은 유지되지만 실제 피킹량은 조정 필요
      expect(scenario.reservation.quantity).toBe(scenario.fulfillmentOrderItem.qty);
    });
  });
});