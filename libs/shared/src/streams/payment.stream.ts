/**
 * Payment Domain Stream Configuration
 * 
 * 결제 도메인 이벤트 스트림 정의
 */

import { StreamConfig, EventType } from '@app/events';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface PaymentCapturedPayload {
  order_id: string;
  payment_id: string;
  amount: number;
  currency_code: string;
  created_at: string; // ISO 8601
}

export interface PaymentRefundRequestPayload {
  refund_id: string;
  user_id: string;
  paymentEventId: string;
  amount: number;
  reason?: string;
}

export interface PaymentRefundCompletedPayload {
  refundId: string;
  data: any; // Medusa의 refund 데이터
  completedAt: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const PaymentCapturedSchema = z.object({
  order_id: z.string().min(1),
  payment_id: z.string().min(1),
  amount: z.number().nonnegative(),
  currency_code: z.string().min(1),
  created_at: z.string().datetime(),
});

const PaymentRefundRequestSchema = z.object({
  refund_id: z.string().min(1),
  user_id: z.string().min(1),
  paymentEventId: z.string().min(1),
  amount: z.number().nonnegative(),
  reason: z.string().optional(),
});

const PaymentRefundCompletedSchema = z.object({
  refundId: z.string().min(1),
  data: z.any(), // Medusa 내부 데이터 구조
  completedAt: z.string().datetime(),
});

// ===== Event Types Map =====

export type PaymentEvents = {
  PaymentCaptured: EventType<PaymentCapturedPayload>;
  PaymentRefundRequest: EventType<PaymentRefundRequestPayload>;
  PaymentRefundCompleted: EventType<PaymentRefundCompletedPayload>;
};

// ===== Stream Config =====

export const PAYMENT_STREAM: StreamConfig<PaymentEvents> = {
  topic: {
    topic: 'payments.events.v1',
    partitions: 6,
  },
  aggregateType: 'Payment',
  events: {
    PaymentCaptured: {
      messageType: 'PaymentCaptured',
      payloadType: {} as PaymentCapturedPayload,
      schema: PaymentCapturedSchema,
    },
    PaymentRefundRequest: {
      messageType: 'PaymentRefundRequest',
      payloadType: {} as PaymentRefundRequestPayload,
      schema: PaymentRefundRequestSchema,
    },
    PaymentRefundCompleted: {
      messageType: 'PaymentRefundCompleted',
      payloadType: {} as PaymentRefundCompletedPayload,
      schema: PaymentRefundCompletedSchema,
    },
  },
};

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const PAYMENT_EVENTS = {
  CAPTURED: { topic: PAYMENT_STREAM.topic.topic },
  REFUND_REQUEST: { topic: PAYMENT_STREAM.topic.topic },
  REFUND_COMPLETED: { topic: PAYMENT_STREAM.topic.topic },
} as const;

