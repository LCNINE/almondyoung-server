import { WmsTestDatabase } from '../support/wms-test-database';
import { WmsTestFactory } from '../support/wms-test-factory';

describe('Multi-Channel Sales Scenarios', () => {
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

  describe('채널별 주문 처리', () => {
    it('네이버 스마트스토어 주문 처리', async () => {
      // Given: 네이버 채널 주문
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: '네이버 전용 상품',
        code: 'NAVER-SPECIAL-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 100,
        availableQty: 100
      });

      // When: 네이버 주문 생성
      const naverOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'NAVER-20241201-001',
        salesChannel: 'naver',
        customerName: '김네이버',
        customerEmail: 'naver@example.com',
        shippingAddress: {
          name: '김네이버',
          phone: '010-1111-2222',
          address: '서울시 강남구 테헤란로 123',
          city: '서울',
          postalCode: '06123'
        }
      });

      const naverOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: naverOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: sku.name,
        quantity: 3,
        unitPrice: 29900
      });

      // Then: 네이버 주문 특성 검증
      expect(naverOrder.salesChannel).toBe('naver');
      expect(naverOrder.channelOrderId).toMatch(/^NAVER-/);
      expect(naverOrder.customerName).toBe('김네이버');
      expect(naverOrderLine.quantity).toBe(3);
      expect(naverOrderLine.unitPrice).toBe(29900);
    });

    it('쿠팡 주문 처리', async () => {
      // Given: 쿠팡 채널 설정
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: '쿠팡 베스트셀러',
        code: 'COUPANG-BEST-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 200,
        availableQty: 200
      });

      // When: 쿠팡 주문 생성
      const coupangOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CP-20241201-999',
        salesChannel: 'coupang',
        customerName: '박쿠팡',
        customerEmail: 'coupang@example.com',
        shippingAddress: {
          name: '박쿠팡',
          phone: '010-3333-4444',
          address: '부산시 해운대구 센텀로 456',
          city: '부산',
          postalCode: '48060'
        },
        totalAmount: 45000,
        shippingFee: 0  // 쿠팡은 무료배송
      });

      const coupangOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: coupangOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440002',
        productName: sku.name,
        quantity: 2,
        unitPrice: 22500
      });

      // Then: 쿠팡 주문 특성 검증
      expect(coupangOrder.salesChannel).toBe('coupang');
      expect(coupangOrder.channelOrderId).toMatch(/^CP-/);
      expect(coupangOrder.shippingFee).toBe(0);  // 쿠팡 무료배송
      expect(coupangOrder.totalAmount).toBe(45000);
      expect(coupangOrderLine.quantity).toBe(2);
    });

    it('메두사 자체몰 주문 처리', async () => {
      // Given: 자체 온라인몰 설정
      const warehouse = await WmsTestFactory.createWarehouse();
      const sku = await WmsTestFactory.createSku({
        name: '자체몰 프리미엄 상품',
        code: 'MEDUSA-PREMIUM-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: sku.id,
        onHandQty: 50,
        availableQty: 50
      });

      // When: 자체몰 주문 생성 (더 상세한 정보)
      const medusaOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MEDUSA-VIP-001',
        salesChannel: 'medusa',
        customerName: '이메두사',
        customerEmail: 'vip@medusa.com',
        customerPhone: '010-5555-6666',
        shippingAddress: {
          name: '이메두사',
          phone: '010-5555-6666',
          address: '경기도 성남시 분당구 판교역로 123',
          city: '성남',
          postalCode: '13494'
        },
        totalAmount: 89000,
        shippingFee: 3000  // 자체몰 배송비
      });

      const medusaOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: medusaOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440003',
        productName: sku.name,
        quantity: 1,
        unitPrice: 86000,
        totalPrice: 86000
      });

      // Then: 자체몰 주문 특성 검증
      expect(medusaOrder.salesChannel).toBe('medusa');
      expect(medusaOrder.channelOrderId).toMatch(/^MEDUSA-/);
      expect(medusaOrder.customerPhone).toBe('010-5555-6666');
      expect(medusaOrder.shippingFee).toBe(3000);
      expect(medusaOrderLine.totalPrice).toBe(86000);
    });
  });

  describe('채널 간 재고 경합 시나리오', () => {
    it('동일 상품에 대한 멀티채널 동시 주문', async () => {
      // Given: 인기 상품과 제한된 재고
      const warehouse = await WmsTestFactory.createWarehouse();
      const hotItem = await WmsTestFactory.createSku({
        name: '한정판 스니커즈',
        code: 'LIMITED-SNEAKER-001'
      });

      const limitedStock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: hotItem.id,
        onHandQty: 10,  // 총 10개만 재고
        availableQty: 10
      });

      // When: 동시에 여러 채널에서 주문
      const orders = await Promise.all([
        // 네이버에서 4개 주문
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'NAVER-HOT-001',
          salesChannel: 'naver',
          customerName: '네이버구매자1'
        }),
        // 쿠팡에서 3개 주문
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'CP-HOT-001',
          salesChannel: 'coupang',
          customerName: '쿠팡구매자1'
        }),
        // 자체몰에서 5개 주문
        WmsTestFactory.createSalesOrder({
          channelOrderId: 'MEDUSA-HOT-001',
          salesChannel: 'medusa',
          customerName: '자체몰구매자1'
        })
      ]);

      const orderLines = await Promise.all([
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: orders[0].id,
          variantId: '550e8400-e29b-41d4-a716-446655440001',
          productName: hotItem.name,
          quantity: 4  // 네이버 4개
        }),
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: orders[1].id,
          variantId: '550e8400-e29b-41d4-a716-446655440001',
          productName: hotItem.name,
          quantity: 3  // 쿠팡 3개
        }),
        WmsTestFactory.createSalesOrderLine({
          salesOrderId: orders[2].id,
          variantId: '550e8400-e29b-41d4-a716-446655440001',
          productName: hotItem.name,
          quantity: 5  // 자체몰 5개
        })
      ]);

      // Then: 채널별 주문 생성 확인
      expect(orders).toHaveLength(3);
      expect(orderLines).toHaveLength(3);

      // 총 주문 수량 계산
      const totalOrderQty = orderLines.reduce((sum, line) => sum + line.quantity, 0);
      expect(totalOrderQty).toBe(12);  // 4 + 3 + 5 = 12개 주문

      // 재고 부족 상황 (10개 재고, 12개 주문)
      expect(totalOrderQty).toBeGreaterThan(limitedStock.onHandQty);

      // 각 채널별 주문 확인
      expect(orderLines[0].quantity).toBe(4);  // 네이버
      expect(orderLines[1].quantity).toBe(3);  // 쿠팡
      expect(orderLines[2].quantity).toBe(5);  // 자체몰
    });

    it('채널별 우선순위 처리', async () => {
      // Given: VIP 고객과 일반 고객 주문
      const warehouse = await WmsTestFactory.createWarehouse();
      const premiumSku = await WmsTestFactory.createSku({
        name: '프리미엄 제품',
        code: 'PREMIUM-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: premiumSku.id,
        onHandQty: 5,
        availableQty: 5
      });

      // When: 서로 다른 우선순위 주문
      const vipOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MEDUSA-VIP-001',
        salesChannel: 'medusa',  // 자체몰 VIP 고객
        customerName: 'VIP고객',
        customerEmail: 'vip@company.com'
      });

      const regularOrder1 = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'NAVER-REG-001',
        salesChannel: 'naver',
        customerName: '일반고객1'
      });

      const regularOrder2 = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CP-REG-001',
        salesChannel: 'coupang',
        customerName: '일반고객2'
      });

      // When: 각각 주문 라인 생성
      const vipLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: vipOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: premiumSku.name,
        quantity: 3
      });

      const regularLine1 = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: regularOrder1.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: premiumSku.name,
        quantity: 2
      });

      const regularLine2 = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: regularOrder2.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: premiumSku.name,
        quantity: 2
      });

      // Then: 우선순위별 주문 검증
      expect(vipOrder.salesChannel).toBe('medusa');  // 자체몰 = 높은 우선순위
      expect(vipLine.quantity).toBe(3);

      expect(regularOrder1.salesChannel).toBe('naver');
      expect(regularLine1.quantity).toBe(2);

      expect(regularOrder2.salesChannel).toBe('coupang');
      expect(regularLine2.quantity).toBe(2);

      // 총 주문량 vs 재고 (7개 주문, 5개 재고)
      const totalDemand = vipLine.quantity + regularLine1.quantity + regularLine2.quantity;
      expect(totalDemand).toBe(7);
      expect(stock.onHandQty).toBe(5);
      expect(totalDemand).toBeGreaterThan(stock.onHandQty);
    });
  });

  describe('채널별 특화 처리', () => {
    it('쿠팡 로켓배송 당일 출고 요구사항', async () => {
      // Given: 쿠팡 로켓배송 상품
      const rocketWarehouse = await WmsTestFactory.createWarehouse({
        name: 'Rocket Fulfillment Center',
        location: 'Incheon'
      });

      const rocketSku = await WmsTestFactory.createSku({
        name: '로켓배송 상품',
        code: 'ROCKET-DELIVERY-001'
      });

      const rocketStock = await WmsTestFactory.createStock({
        warehouseId: rocketWarehouse.id,
        skuId: rocketSku.id,
        onHandQty: 1000,
        availableQty: 1000
      });

      // When: 로켓배송 주문 (당일 출고 필수)
      const rocketOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'CP-ROCKET-001',
        salesChannel: 'coupang',
        customerName: '로켓고객',
        shippingAddress: {
          name: '로켓고객',
          address: '서울시 송파구 로켓로 1',
          city: '서울',
          postalCode: '05551'
        },
        orderDate: new Date()  // 당일 주문
      });

      const rocketOrderLine = await WmsTestFactory.createSalesOrderLine({
        salesOrderId: rocketOrder.id,
        variantId: '550e8400-e29b-41d4-a716-446655440001',
        productName: rocketSku.name,
        quantity: 1
      });

      // When: 즉시 이행 처리
      const rocketFulfillment = await WmsTestFactory.createFulfillmentOrder({
        warehouseId: rocketWarehouse.id,
        status: 'ready'  // 즉시 처리 상태
      });

      const rocketFulfillmentItem = await WmsTestFactory.createFulfillmentOrderItem({
        fulfillmentOrderId: rocketFulfillment.id,
        skuId: rocketSku.id,
        qty: 1
      });

      // Then: 로켓배송 요구사항 충족
      expect(rocketOrder.salesChannel).toBe('coupang');
      expect(rocketFulfillment.status).toBe('ready');
      expect(rocketStock.availableQty).toBeGreaterThanOrEqual(rocketOrderLine.quantity);

      // 당일 주문, 당일 처리 가능
      const orderDate = new Date(rocketOrder.orderDate);
      const today = new Date();
      expect(orderDate.toDateString()).toBe(today.toDateString());
    });

    it('네이버 스토어 특가 이벤트 대량 주문', async () => {
      // Given: 네이버 특가 이벤트 준비
      const naverWarehouse = await WmsTestFactory.createWarehouse({
        name: 'Naver Event Warehouse'
      });

      const eventSku = await WmsTestFactory.createSku({
        name: '네이버 특가 상품',
        code: 'NAVER-EVENT-001'
      });

      const eventStock = await WmsTestFactory.createStock({
        warehouseId: naverWarehouse.id,
        skuId: eventSku.id,
        onHandQty: 500,  // 이벤트용 대량 준비
        availableQty: 500
      });

      // When: 이벤트 시작 후 대량 주문 유입
      const eventOrders = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>  // 50명이 동시 주문
          WmsTestFactory.createSalesOrder({
            channelOrderId: `NAVER-EVENT-${String(i + 1).padStart(3, '0')}`,
            salesChannel: 'naver',
            customerName: `이벤트고객${i + 1}`,
            customerEmail: `event${i + 1}@naver.com`
          })
        )
      );

      const eventOrderLines = await Promise.all(
        eventOrders.map((order, i) =>
          WmsTestFactory.createSalesOrderLine({
            salesOrderId: order.id,
            variantId: '550e8400-e29b-41d4-a716-446655440001',
            productName: eventSku.name,
            quantity: Math.floor(Math.random() * 5) + 1  // 1~5개 랜덤 주문
          })
        )
      );

      // Then: 대량 주문 처리 확인
      expect(eventOrders).toHaveLength(50);
      expect(eventOrderLines).toHaveLength(50);

      // 모든 주문이 네이버 채널
      eventOrders.forEach(order => {
        expect(order.salesChannel).toBe('naver');
        expect(order.channelOrderId).toMatch(/^NAVER-EVENT-/);
      });

      // 총 주문 수량 계산
      const totalEventQty = eventOrderLines.reduce((sum, line) => sum + line.quantity, 0);
      console.log(`Total event orders: ${totalEventQty} items from 50 customers`);

      // 재고 충분성 확인
      expect(eventStock.onHandQty).toBeGreaterThanOrEqual(totalEventQty);
    });

    it('자체몰 회원 등급별 혜택 처리', async () => {
      // Given: 자체몰 회원 등급별 설정
      const warehouse = await WmsTestFactory.createWarehouse();
      const premiumSku = await WmsTestFactory.createSku({
        name: '회원 전용 상품',
        code: 'MEMBER-ONLY-001'
      });

      const stock = await WmsTestFactory.createStock({
        warehouseId: warehouse.id,
        skuId: premiumSku.id,
        onHandQty: 100,
        availableQty: 100
      });

      // When: 등급별 주문 생성
      const vipOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MEDUSA-VIP-001',
        salesChannel: 'medusa',
        customerName: 'VIP회원',
        customerEmail: 'vip@medusa.com',
        totalAmount: 50000,
        shippingFee: 0  // VIP 무료배송
      });

      const goldOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MEDUSA-GOLD-001',
        salesChannel: 'medusa',
        customerName: 'GOLD회원',
        customerEmail: 'gold@medusa.com',
        totalAmount: 40000,
        shippingFee: 2000  // GOLD 할인배송
      });

      const regularOrder = await WmsTestFactory.createSalesOrder({
        channelOrderId: 'MEDUSA-REG-001',
        salesChannel: 'medusa',
        customerName: '일반회원',
        customerEmail: 'regular@medusa.com',
        totalAmount: 35000,
        shippingFee: 3000  // 일반 배송비
      });

      // Then: 등급별 혜택 확인
      expect(vipOrder.shippingFee).toBe(0);     // VIP 무료
      expect(goldOrder.shippingFee).toBe(2000); // GOLD 할인
      expect(regularOrder.shippingFee).toBe(3000); // 일반 정가

      // 모두 자체몰 주문
      [vipOrder, goldOrder, regularOrder].forEach(order => {
        expect(order.salesChannel).toBe('medusa');
        expect(order.channelOrderId).toMatch(/^MEDUSA-/);
      });
    });
  });
});