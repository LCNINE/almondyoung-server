/**
 * Order Domain Stream Configuration
 * 
 * 주문 도메인 이벤트 스트림 정의
 */

import { StreamConfig, EventType } from '@app/events';
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
  order_id: string;
  payment_id: string;
  amount: number;
  currency_code: string;
  captured_at: string; // ISO 8601
}

export interface OrderReturnRequestedPayload {
  order_id: string;
  return_id: string;
  items: Array<{
    item_id: string;
    quantity: number;
    reason: string;
  }>;
  note?: string;
  requested_at: string; // ISO 8601
}

export interface OrderRefundCreatedPayload {
  order_id: string;
  refund_id: string;
  amount: number;
  currency_code: string;
  reason: string;
  note?: string;
  created_at: string; // ISO 8601
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
  order_id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: z.number().nonnegative(),
  currency_code: z.string().min(1),
  captured_at: z.string().datetime(),
});

const ReturnItemSchema = z.object({
  item_id: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
});

const OrderReturnRequestedSchema = z.object({
  order_id: z.string().min(1),
  return_id: z.string().min(1),
  items: z.array(ReturnItemSchema),
  note: z.string().optional(),
  requested_at: z.string().datetime(),
});

const OrderRefundCreatedSchema = z.object({
  order_id: z.string().min(1),
  refund_id: z.string().min(1),
  amount: z.number().nonnegative(),
  currency_code: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().optional(),
  created_at: z.string().datetime(),
});

// ===== Event Types Map =====

export type OrderEvents = {
  OrderCreated: EventType<OrderCreatedPayload>;
  OrderCancelled: EventType<OrderCancelledPayload>;
  OrderPaymentComplete: EventType<OrderPaymentCompletePayload>;
  OrderReturnRequested: EventType<OrderReturnRequestedPayload>;
  OrderRefundCreated: EventType<OrderRefundCreatedPayload>;
};

// ===== Stream Config =====

export const ORDER_STREAM: StreamConfig<OrderEvents> = {
  topic: {
    topic: 'orders.events.v1',
    partitions: 12, // 주문은 더 많은 파티션 권장
  },
  aggregateType: 'Order',
  events: {
    OrderCreated: {
      messageType: 'OrderCreated',
      payloadType: {} as OrderCreatedPayload,
      schema: OrderCreatedSchema,
    },
    OrderCancelled: {
      messageType: 'OrderCancelled',
      payloadType: {} as OrderCancelledPayload,
      schema: OrderCancelledSchema,
    },
    OrderPaymentComplete: {
      messageType: 'OrderPaymentComplete',
      payloadType: {} as OrderPaymentCompletePayload,
      schema: OrderPaymentCompleteSchema,
    },
    OrderReturnRequested: {
      messageType: 'OrderReturnRequested',
      payloadType: {} as OrderReturnRequestedPayload,
      schema: OrderReturnRequestedSchema,
    },
    OrderRefundCreated: {
      messageType: 'OrderRefundCreated',
      payloadType: {} as OrderRefundCreatedPayload,
      schema: OrderRefundCreatedSchema,
    },
  },
};

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const ORDER_EVENTS = {
  ORDER_CREATED: { topic: ORDER_STREAM.topic.topic },
  ORDER_CANCELLED: { topic: ORDER_STREAM.topic.topic },
  ORDER_RETURN_REQUESTED: { topic: ORDER_STREAM.topic.topic },
} as const;

