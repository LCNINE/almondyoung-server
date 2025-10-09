/**
 * Order Domain Stream Configuration
 *
 * 주문 도메인 이벤트 스트림 정의
 */

import { event, stream, EventType, StreamConfig } from '@app/events';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface OrderCreatedPayload {
  orderId: string;
  status: string;
  total: number;
  items: Array<{
    id: string;
    quantity: number;
  }>;
}

export interface OrderCancelledPayload {
  orderId: string;
  status: string;
}

export interface OrderPaymentCompletePayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currencyCode: string;
  capturedAt: string; // ISO 8601
}

export interface OrderReturnRequestedPayload {
  orderId: string;
  returnId: string;
  items: Array<{
    itemId: string;
    quantity: number;
    reason: string;
  }>;
  note?: string;
  requestedAt: string; // ISO 8601
}

export interface OrderRefundCreatedPayload {
  orderId: string;
  refundId: string;
  amount: number;
  currencyCode: string;
  reason: string;
  note?: string;
  createdAt: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const OrderItemSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().positive(),
});

const OrderCreatedSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  total: z.number().nonnegative(),
  items: z.array(OrderItemSchema),
});

const OrderCancelledSchema = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
});

const OrderPaymentCompleteSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currencyCode: z.string().min(1),
  capturedAt: z.string().datetime(),
});

const ReturnItemSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
});

const OrderReturnRequestedSchema = z.object({
  orderId: z.string().min(1),
  returnId: z.string().min(1),
  items: z.array(ReturnItemSchema),
  note: z.string().optional(),
  requestedAt: z.string().datetime(),
});

const OrderRefundCreatedSchema = z.object({
  orderId: z.string().min(1),
  refundId: z.string().min(1),
  amount: z.number().nonnegative(),
  currencyCode: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().optional(),
  createdAt: z.string().datetime(),
});

// ===== Stream Config (타입 안전 버전) =====

export const ORDER_STREAM = stream({
  topic: 'orders.events.v1',
  partitions: 12, // 주문은 더 많은 파티션 권장
  aggregateType: 'Order',
  events: {
    OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated', OrderCreatedSchema),
    OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled', OrderCancelledSchema),
    OrderPaymentComplete: event<'OrderPaymentComplete', OrderPaymentCompletePayload>('OrderPaymentComplete', OrderPaymentCompleteSchema),
    OrderReturnRequested: event<'OrderReturnRequested', OrderReturnRequestedPayload>('OrderReturnRequested', OrderReturnRequestedSchema),
    OrderRefundCreated: event<'OrderRefundCreated', OrderRefundCreatedPayload>('OrderRefundCreated', OrderRefundCreatedSchema),
  },
});

// ===== 타입 추론 =====

export type OrderEvents = typeof ORDER_STREAM.events;

// Medusa 호환성: 레거시 이벤트 토픽 참조
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

