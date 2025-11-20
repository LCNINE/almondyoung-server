/**
 * OMS 주문 정보 (세금계산서 발행에 필요한 정보)
 */
export interface OmsOrder {
  orderId: string;
  orderNumber?: string;
  userId: string;
  amount: number;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
  completedAt?: Date;
  items?: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OMS 웹훅 이벤트
 */
export interface OmsWebhookEvent {
  eventId: string;
  orderId: string;
  userId: string;
  eventType: 'CANCELLED' | 'REFUNDED' | 'PARTIAL_REFUNDED';
  amount?: number; // 환불 금액 (부분 환불 시)
  timestamp: Date;
  signature?: string; // HMAC 서명
}

/**
 * OMS Client Interface
 *
 * OMS와의 통신을 담당하는 인터페이스
 */
export interface IOmsClient {
  /**
   * 주문 정보 조회
   * @throws Error 주문을 찾을 수 없거나 타임아웃 시
   */
  getOrder(orderId: string): Promise<OmsOrder>;

  /**
   * 여러 주문 정보 일괄 조회
   */
  getOrders(orderIds: string[]): Promise<OmsOrder[]>;

  /**
   * 웹훅 서명 검증
   */
  verifyWebhookSignature(payload: string, signature: string): boolean;
}

