/**
 * Cart Domain Stream Configuration
 * 
 * 장바구니 도메인 이벤트 스트림 정의
 */

import { StreamConfig, EventType } from '@app/events';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface CartCreatedPayload {
  id: string;
  customer_id: string;
  region_id: string;
  created_at: string; // ISO 8601
}

export interface CartUpdatedPayload {
  id: string;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number;
    variant_id: string;
  }>;
  total: number;
  subtotal: number;
  updated_at: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const CartCreatedSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  region_id: z.string().min(1),
  created_at: z.string().datetime(),
});

const CartItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  variant_id: z.string().min(1),
});

const CartUpdatedSchema = z.object({
  id: z.string().min(1),
  items: z.array(CartItemSchema),
  total: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
  updated_at: z.string().datetime(),
});

// ===== Event Types Map =====

export type CartEvents = {
  CartCreated: EventType<CartCreatedPayload>;
  CartUpdated: EventType<CartUpdatedPayload>;
};

// ===== Stream Config =====

export const CART_STREAM: StreamConfig<CartEvents> = {
  topic: {
    topic: 'carts.events.v1',
    partitions: 6,
  },
  aggregateType: 'Cart',
  events: {
    CartCreated: {
      messageType: 'CartCreated',
      payloadType: {} as CartCreatedPayload,
      schema: CartCreatedSchema,
    },
    CartUpdated: {
      messageType: 'CartUpdated',
      payloadType: {} as CartUpdatedPayload,
      schema: CartUpdatedSchema,
    },
  },
};

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const CART_EVENTS = {
  CART_CREATED: { topic: CART_STREAM.topic.topic },
  CART_UPDATED: { topic: CART_STREAM.topic.topic },
} as const;

