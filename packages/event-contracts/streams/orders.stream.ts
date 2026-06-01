/**
 * Orders Stream
 *
 * 주문 도메인 이벤트 스트림
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Common Types =====

export interface OrderItem {
  orderItemId: string;
  skuId: string;
  masterId: string;
  versionId: string;
  variantId: string;
  productName: string;
  channelProductId: string;
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
  /**
   * 내부 user-service 사용자 UUID. 로그인 채널(medusa)은 Medusa customer.metadata.almond_user_id 에서 해석.
   * 비-로그인 외부 채널(Naver/Coupang) 또는 미링크 고객은 null. (core sales_orders.customer_id 는 nullable uuid)
   */
  customerId: string | null;
  /** almond-payment(Wallet) 결제 인텐트 ID. Medusa 주문에만 존재; 다른 채널은 undefined. */
  walletIntentId?: string;

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

// ===== Zod 스키마 정의 =====

const SalesChannelSchema = z.enum(['medusa', 'naver', 'coupang', '3pl']);
const OrderStatusSchema = z.enum(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'timeout']);

const OrderItemSchema = z.object({
  orderItemId: z.string().min(1),
  skuId: z.string().min(1),
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  variantId: z.string().min(1),
  productName: z.string().min(1),
  channelProductId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  totalPrice: z.number().nonnegative(),
});

const ShippingAddressSchema = z.object({
  recipientName: z.string().min(1),
  phone: z.string(),
  postalCode: z.string(),
  roadAddress: z.string(),
  detailAddress: z.string(),
  deliveryNote: z.string().optional(),
});

const OrderCreatedSchema = z.object({
  orderId: z.string().min(1),
  externalOrderId: z.string().optional(),
  salesChannel: SalesChannelSchema,
  customerId: z.string().min(1).nullable(),
  walletIntentId: z.string().optional(),
  items: z.array(OrderItemSchema),
  totalAmount: z.number().nonnegative(),
  subtotalAmount: z.number().nonnegative(),
  shippingAmount: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  currency: z.string().min(1),
  shippingAddress: ShippingAddressSchema,
  status: OrderStatusSchema,
  createdAt: z.string().datetime(),
});

const OrderModifiedSchema = z.object({
  orderId: z.string().min(1),
  changes: z.object({
    items: z.array(OrderItemSchema).optional(),
    shippingAddress: ShippingAddressSchema.optional(),
    totalAmount: z.number().nonnegative().optional(),
  }),
  modifiedBy: z.string().min(1),
  modifiedAt: z.string().datetime(),
  reason: z.string().optional(),
});

const OrderCancelledSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum(['CUSTOMER_REQUEST', 'OUT_OF_STOCK', 'PAYMENT_FAILED', 'ADMIN_CANCEL', 'TIMEOUT']),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().min(1),
  cancelledAt: z.string().datetime(),
  refundRequired: z.boolean(),
  refundAmount: z.number().nonnegative().optional(),
  stockRestorationResults: z.array(z.object({
    orderItemId: z.string().min(1),
    skuId: z.string().min(1),
    restoredQty: z.number().int().nonnegative(),
    stockEventId: z.string().optional(),
  })).optional(),
});

const OrderPaymentCompletedSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  capturedAt: z.string().datetime(),
});

const OrderReturnRequestedSchema = z.object({
  orderId: z.string().min(1),
  returnId: z.string().min(1),
  items: z.array(z.object({
    orderItemId: z.string().min(1),
    skuId: z.string().min(1),
    quantity: z.number().int().positive(),
    reason: z.enum(['DEFECTIVE', 'WRONG_ITEM', 'CUSTOMER_CHANGED_MIND', 'SIZE_NOT_FIT']),
    reasonDetail: z.string().optional(),
  })),
  requestedBy: z.enum(['CUSTOMER', 'ADMIN']),
  requestedAt: z.string().datetime(),
  note: z.string().optional(),
});

const OrderRefundCreatedSchema = z.object({
  orderId: z.string().min(1),
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
});

const OrderMergedSchema = z.object({
  targetOrderId: z.string().min(1),
  sourceOrderIds: z.array(z.string().min(1)),
  mergedBy: z.string().min(1),
  mergedAt: z.string().datetime(),
  reason: z.string().optional(),
});

// ===== Stream Config (타입 안전 버전) =====

export const ORDER_STREAM = stream({
  topic: 'orders.events.v1',
  partitions: 12,
  aggregateType: 'Order',
  events: {
    OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated', OrderCreatedSchema),
    OrderModified: event<'OrderModified', OrderModifiedPayload>('OrderModified', OrderModifiedSchema),
    OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled', OrderCancelledSchema),
    OrderPaymentCompleted: event<'OrderPaymentCompleted', OrderPaymentCompletedPayload>('OrderPaymentCompleted', OrderPaymentCompletedSchema),
    OrderReturnRequested: event<'OrderReturnRequested', OrderReturnRequestedPayload>('OrderReturnRequested', OrderReturnRequestedSchema),
    OrderRefundCreated: event<'OrderRefundCreated', OrderRefundCreatedPayload>('OrderRefundCreated', OrderRefundCreatedSchema),
    OrderMerged: event<'OrderMerged', OrderMergedPayload>('OrderMerged', OrderMergedSchema),
  },
});

// ===== 타입 추론 =====

export type OrderEvents = typeof ORDER_STREAM.events;

// =============================================================================
// [LEGACY] Medusa 호환성 코드 - 추후 Medusa 마이그레이션 완료 시 삭제 예정
// =============================================================================
// TODO: Medusa에서 ORDER_STREAM을 직접 사용하도록 마이그레이션 후 삭제
// @see apps/medusa/src/subscribers/order.ts
// =============================================================================

/**
 * @deprecated ORDER_STREAM을 직접 사용하세요.
 * Medusa 마이그레이션 완료 후 삭제 예정입니다.
 */
export const ORDER_EVENTS = {
  ORDER_CREATED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderCreated' as const,
  },
  ORDER_CANCELLED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderCancelled' as const,
  },
  ORDER_RETURN_REQUESTED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderReturnRequested' as const,
  },
} as const;
