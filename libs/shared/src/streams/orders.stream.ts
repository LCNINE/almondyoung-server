/**
 * Orders Stream
 *
 * 주문 도메인 이벤트 스트림
 */

import { StreamConfig, EventType } from '@app/events';

// ===== Common Types =====

export interface OrderItem {
  orderItemId: string;
  skuId: string;
  productId?: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
}

export type SalesChannel = 'medusa' | 'naver' | 'coupang' | '3pl';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'timeout';

// ===== Event Payloads =====

/**
 * 주문 생성 이벤트
 */
export interface OrderCreatedPayload {
  orderId: string;
  externalOrderId?: string;
  salesChannel: SalesChannel;
  customerId: string;

  items: OrderItem[];

  totalAmount: number;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  currency: string;

  shippingAddress: ShippingAddress;

  status: OrderStatus;
  createdAt: string;
}

/**
 * 주문 확정 이벤트 (결제 완료)
 */
export interface OrderConfirmedPayload {
  orderId: string;
  confirmedAt: string;
  confirmedBy: string;

  // 재고 차감 결과
  stockDeductionResults: Array<{
    orderItemId: string;
    skuId: string;
    requestedQty: number;
    deductedQty: number;
    stockEventId?: string;
  }>;
}

/**
 * 주문 수정 이벤트
 */
export interface OrderModifiedPayload {
  orderId: string;

  changes: {
    items?: OrderItem[];
    shippingAddress?: ShippingAddress;
    totalAmount?: number;
  };

  modifiedBy: string;
  modifiedAt: string;
  reason?: string;
}

/**
 * 주문 취소 이벤트
 */
export interface OrderCancelledPayload {
  orderId: string;
  reason:
    | 'CUSTOMER_REQUEST'
    | 'OUT_OF_STOCK'
    | 'PAYMENT_FAILED'
    | 'ADMIN_CANCEL'
    | 'TIMEOUT';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;

  refundRequired: boolean;
  refundAmount?: number;

  // 재고 복원 정보
  stockRestorationResults?: Array<{
    orderItemId: string;
    skuId: string;
    restoredQty: number;
    stockEventId?: string;
  }>;
}

/**
 * 주문 결제 완료 이벤트 (Medusa 전용)
 */
export interface OrderPaymentCompletedPayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  capturedAt: string;
}

/**
 * 반품 요청 이벤트
 */
export interface OrderReturnRequestedPayload {
  orderId: string;
  returnId: string;

  items: Array<{
    orderItemId: string;
    skuId: string;
    quantity: number;
    reason: 'DEFECTIVE' | 'WRONG_ITEM' | 'CUSTOMER_CHANGED_MIND' | 'SIZE_NOT_FIT';
    reasonDetail?: string;
  }>;

  requestedBy: 'CUSTOMER' | 'ADMIN';
  requestedAt: string;
  note?: string;
}

/**
 * 환불 생성 이벤트
 */
export interface OrderRefundCreatedPayload {
  orderId: string;
  refundId: string;
  paymentId: string;

  amount: number;
  currency: string;
  reason: string;
  note?: string;

  createdBy: string;
  createdAt: string;
}

/**
 * 주문 병합 이벤트
 */
export interface OrderMergedPayload {
  targetOrderId: string;
  sourceOrderIds: string[];

  mergedBy: string;
  mergedAt: string;
  reason?: string;
}

// ===== Event Types Map =====

export type OrderEvents = {
  OrderCreated: EventType<OrderCreatedPayload>;
  OrderConfirmed: EventType<OrderConfirmedPayload>;
  OrderModified: EventType<OrderModifiedPayload>;
  OrderCancelled: EventType<OrderCancelledPayload>;
  OrderPaymentCompleted: EventType<OrderPaymentCompletedPayload>;
  OrderReturnRequested: EventType<OrderReturnRequestedPayload>;
  OrderRefundCreated: EventType<OrderRefundCreatedPayload>;
  OrderMerged: EventType<OrderMergedPayload>;
};

// ===== Stream Config =====

export const ORDER_STREAM: StreamConfig<OrderEvents> = {
  topic: {
    topic: 'orders.events.v1',
    partitions: 12,
  },
  aggregateType: 'Order',
  events: {
    OrderCreated: {
      messageType: 'OrderCreated',
      payloadType: {} as OrderCreatedPayload,
    },
    OrderConfirmed: {
      messageType: 'OrderConfirmed',
      payloadType: {} as OrderConfirmedPayload,
    },
    OrderModified: {
      messageType: 'OrderModified',
      payloadType: {} as OrderModifiedPayload,
    },
    OrderCancelled: {
      messageType: 'OrderCancelled',
      payloadType: {} as OrderCancelledPayload,
    },
    OrderPaymentCompleted: {
      messageType: 'OrderPaymentCompleted',
      payloadType: {} as OrderPaymentCompletedPayload,
    },
    OrderReturnRequested: {
      messageType: 'OrderReturnRequested',
      payloadType: {} as OrderReturnRequestedPayload,
    },
    OrderRefundCreated: {
      messageType: 'OrderRefundCreated',
      payloadType: {} as OrderRefundCreatedPayload,
    },
    OrderMerged: {
      messageType: 'OrderMerged',
      payloadType: {} as OrderMergedPayload,
    },
  },
};

// ===== Event Type Constants =====

export const OrderEventTypes = {
  CREATED: 'OrderCreated',
  CONFIRMED: 'OrderConfirmed',
  MODIFIED: 'OrderModified',
  CANCELLED: 'OrderCancelled',
  PAYMENT_COMPLETED: 'OrderPaymentCompleted',
  RETURN_REQUESTED: 'OrderReturnRequested',
  REFUND_CREATED: 'OrderRefundCreated',
  MERGED: 'OrderMerged',
} as const;
