/**
 * Payment Domain Stream Configuration
 *
 * 결제 도메인 이벤트 스트림 정의
 */

import { event, stream, EventType, StreamConfig } from '@app/events';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface PaymentCapturedPayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currencyCode: string;
  createdAt: string; // ISO 8601
}

export interface PaymentRefundRequestPayload {
  refundId: string;
  userId: string;
  paymentEventId: string;
  amount: number;
  reason?: string;
}

export interface PaymentRefundCompletedPayload {
  refundId: string;
  paymentId: string;
  orderId?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  metadata?: Record<string, unknown>;
  completedAt: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const PaymentCapturedSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currencyCode: z.string().min(1),
  createdAt: z.string().datetime(),
});

const PaymentRefundRequestSchema = z.object({
  refundId: z.string().min(1),
  userId: z.string().min(1),
  paymentEventId: z.string().min(1),
  amount: z.number().nonnegative(),
  reason: z.string().optional(),
});

const PaymentRefundCompletedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  orderId: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  status: z.enum(['pending', 'succeeded', 'failed']),
  metadata: z.record(z.string(), z.unknown()).optional(),
  completedAt: z.string().datetime(),
});

// ===== Stream Config (타입 안전 버전) =====

export const PAYMENT_STREAM = stream({
  topic: 'payments.events.v1',
  partitions: 6,
  aggregateType: 'Payment',
  events: {
    PaymentCaptured: event<'PaymentCaptured', PaymentCapturedPayload>('PaymentCaptured', PaymentCapturedSchema),
    PaymentRefundRequest: event<'PaymentRefundRequest', PaymentRefundRequestPayload>('PaymentRefundRequest', PaymentRefundRequestSchema),
    PaymentRefundCompleted: event<'PaymentRefundCompleted', PaymentRefundCompletedPayload>('PaymentRefundCompleted', PaymentRefundCompletedSchema),
  },
});

// ===== 타입 추론 =====

export type PaymentEvents = typeof PAYMENT_STREAM.events;

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const PAYMENT_EVENTS = {
  CAPTURED: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentCaptured' as const,
  },
  REFUND_REQUEST: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentRefundRequest' as const,
  },
  REFUND_COMPLETED: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentRefundCompleted' as const,
  },
} as const;

