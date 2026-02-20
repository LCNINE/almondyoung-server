/**
 * Cart Domain Stream Configuration
 *
 * 장바구니 도메인 이벤트 스트림 정의
 */

import { event, stream, EventType, StreamConfig } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface CartCreatedPayload {
  id: string;
  userId: string;
  regionId: string;
  createdAt: string; // ISO 8601
}

export interface CartUpdatedPayload {
  id: string;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unitPrice: number;
    variantId: string;
  }>;
  total: number;
  subtotal: number;
  updatedAt: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const CartCreatedSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  regionId: z.string().min(1),
  createdAt: z.string().datetime(),
});

const CartItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  variantId: z.string().min(1),
});

const CartUpdatedSchema = z.object({
  id: z.string().min(1),
  items: z.array(CartItemSchema),
  total: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});

// ===== Stream Config (타입 안전 버전) =====

export const CART_STREAM = stream({
  topic: 'carts.events.v1',
  partitions: 6,
  aggregateType: 'Cart',
  events: {
    CartCreated: event('CartCreated', CartCreatedSchema),
    CartUpdated: event('CartUpdated', CartUpdatedSchema),
  },
});

// ===== 타입 추론 =====

export type CartEvents = typeof CART_STREAM.events;

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const CART_EVENTS = {
  CART_CREATED: {
    topic: CART_STREAM.topic.topic,
    messageType: 'CartCreated' as const,
  },
  CART_UPDATED: {
    topic: CART_STREAM.topic.topic,
    messageType: 'CartUpdated' as const,
  },
} as const;

