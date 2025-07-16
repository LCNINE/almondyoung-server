import { z } from 'zod';
import {
  payment,
  paymentEvent,
  refund,
  refundEvent,
  paymentRelations,
  paymentEventRelations,
  refundRelations,
  refundEventRelations,
} from '../shared/schemas/payment.schema';
import { paymentMethod } from '../shared/schemas/payment-method.schema';
import { invoice } from '../invoice/schema';
import { bnplAccount, bnplTransaction } from '../bnpl/schema';

// 공용 스키마 re-export
export {
  payment,
  paymentEvent,
  refund,
  refundEvent,
  paymentRelations,
  paymentEventRelations,
  refundRelations,
  refundEventRelations,
};

// ────────────────────────────────────────────
// Zod 스키마 (nestjs-zod용)
// ────────────────────────────────────────────

// Payment 스키마
export const PaymentSchema = z.object({
  id: z.string(),
  invoiceId: z.number().int(),
  paymentMethodId: z.string(),
  amount: z.number().positive(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']),
  paymentType: z.enum(['CARD', 'BANK_TRANSFER', 'BNPL', 'REWARD_POINT']),
  description: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional().nullable(),
});

// PaymentEvent 스키마
export const PaymentEventSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  eventType: z.enum([
    'PAYMENT_REQUESTED',
    'PAYMENT_AUTHORIZED',
    'PAYMENT_CAPTURED',
    'PAYMENT_FAILED',
    'PAYMENT_REFUNDED',
    'PAYMENT_VOIDED',
  ]),
  amount: z.number().positive(),
  pgTransactionId: z.string().optional().nullable(),
  pgResponse: z.string().optional().nullable(),
  actor: z.enum(['USER', 'SYSTEM', 'ADMIN', 'SCHEDULER']),
  reason: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
  createdAt: z.date(),
});

// Refund 스키마
export const RefundSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  amount: z.number().positive(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  reason: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().optional().nullable(),
});

// RefundEvent 스키마
export const RefundEventSchema = z.object({
  id: z.string(),
  refundId: z.string(),
  eventType: z.enum([
    'REFUND_REQUESTED',
    'REFUND_PROCESSED',
    'REFUND_COMPLETED',
    'REFUND_FAILED',
  ]),
  amount: z.number().positive(),
  pgTransactionId: z.string().optional().nullable(),
  pgResponse: z.string().optional().nullable(),
  actor: z.enum(['USER', 'SYSTEM', 'ADMIN']),
  reason: z.string().optional().nullable(),
  metadata: z.string().optional().nullable(),
  createdAt: z.date(),
});

// 결제 생성 스키마
export const CreatePaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  paymentMethodId: z.string(),
  amount: z.number().positive(),
  paymentType: z.enum(['CARD', 'BANK_TRANSFER', 'BNPL', 'REWARD_POINT']),
  description: z.string().optional(),
  metadata: z.string().optional(),
});

// 환불 생성 스키마
export const CreateRefundSchema = z.object({
  paymentId: z.string(),
  amount: z.number().positive(),
  reason: z.string(),
  metadata: z.string().optional(),
});

// 타입 추출
export type Payment = z.infer<typeof PaymentSchema>;
export type PaymentEvent = z.infer<typeof PaymentEventSchema>;
export type Refund = z.infer<typeof RefundSchema>;
export type RefundEvent = z.infer<typeof RefundEventSchema>;
export type CreatePayment = z.infer<typeof CreatePaymentSchema>;
export type CreateRefund = z.infer<typeof CreateRefundSchema>;