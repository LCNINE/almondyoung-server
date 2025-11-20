import { Injectable, Logger } from '@nestjs/common';
import type { IOmsClient, OmsOrder } from './oms-client.interface';

/**
 * OmsClientMock - OMS Client 목업 구현
 *
 * 개발 및 테스트용 OMS Client
 */
@Injectable()
export class OmsClientMock implements IOmsClient {
  private readonly logger = new Logger(OmsClientMock.name);

  // 목업 데이터
  private mockOrders: Map<string, OmsOrder> = new Map();

  constructor() {
    this.initMockData();
  }

  /**
   * 목업 데이터 초기화
   */
  private initMockData(): void {
    // 샘플 주문 데이터
    this.mockOrders.set('order_001', {
      orderId: 'order_001',
      orderNumber: 'ORD-2025-001',
      userId: 'user_123',
      amount: 110000, // 10만원 + 부가세
      status: 'DELIVERED',
      completedAt: new Date('2025-01-15'),
      items: [
        {
          itemId: 'item_001',
          itemName: '테스트 상품 A',
          specification: '규격 A',
          quantity: 2,
          unitPrice: 50000,
          totalPrice: 100000,
        },
      ],
      paymentMethod: 'CARD',
      memo: '테스트 주문',
      createdAt: new Date('2025-01-10'),
      updatedAt: new Date('2025-01-15'),
    });

    this.mockOrders.set('order_002', {
      orderId: 'order_002',
      orderNumber: 'ORD-2025-002',
      userId: 'user_456',
      amount: 55000,
      status: 'DELIVERED',
      completedAt: new Date('2025-01-20'),
      items: [
        {
          itemId: 'item_002',
          itemName: '테스트 상품 B',
          quantity: 1,
          unitPrice: 50000,
          totalPrice: 50000,
        },
      ],
      createdAt: new Date('2025-01-18'),
      updatedAt: new Date('2025-01-20'),
    });

    this.mockOrders.set('order_cancelled', {
      orderId: 'order_cancelled',
      orderNumber: 'ORD-2025-003',
      userId: 'user_789',
      amount: 110000,
      status: 'CANCELLED',
      createdAt: new Date('2025-01-25'),
      updatedAt: new Date('2025-01-26'),
    });

    this.logger.log('Mock OMS data initialized');
  }

  /**
   * 주문 정보 조회
   */
  async getOrder(orderId: string): Promise<OmsOrder> {
    this.logger.log(`[MOCK] Getting order: ${orderId}`);

    const order = this.mockOrders.get(orderId);

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // 약간의 지연 시뮬레이션 (10~50ms) - 테스트 속도 향상
    await this.delay(10 + Math.random() * 40);

    return order;
  }

  /**
   * 여러 주문 정보 일괄 조회
   */
  async getOrders(orderIds: string[]): Promise<OmsOrder[]> {
    this.logger.log(`[MOCK] Getting orders: ${orderIds.join(', ')}`);

    const orders: OmsOrder[] = [];
    for (const orderId of orderIds) {
      try {
        const order = await this.getOrder(orderId);
        orders.push(order);
      } catch (error) {
        this.logger.warn(`Failed to get order ${orderId}: ${error.message}`);
      }
    }

    return orders;
  }

  /**
   * 웹훅 서명 검증
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    this.logger.log('[MOCK] Verifying webhook signature');

    // 목업에서는 항상 true 반환
    // 실제 구현에서는 HMAC-SHA256 등으로 검증
    return true;
  }

  /**
   * 목업 주문 추가 (테스트용)
   */
  addMockOrder(order: OmsOrder): void {
    this.mockOrders.set(order.orderId, order);
    this.logger.log(`[MOCK] Order added: ${order.orderId}`);
  }

  /**
   * 목업 주문 업데이트 (테스트용)
   */
  updateMockOrder(orderId: string, updates: Partial<OmsOrder>): void {
    const order = this.mockOrders.get(orderId);
    if (order) {
      Object.assign(order, updates);
      this.logger.log(`[MOCK] Order updated: ${orderId}`);
    }
  }

  /**
   * 지연 유틸리티
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

