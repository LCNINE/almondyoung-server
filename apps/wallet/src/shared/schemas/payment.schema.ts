import { relations } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  decimal,
  bigint,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { paymentMethod } from './payment-method.schema';

/**
 * 결제 (Payment)
 * 결제 정보를 저장하는 테이블입니다.
 * 모든 결제 방식(카드, 계좌이체, BNPL 등)에서 공통으로 사용됩니다.
 */
export const payment = pgTable('payment', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  
  // 결제 관련 정보
  invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
  paymentMethodId: varchar('payment_method_id', { length: 26 })
    .notNull()
    .references(() => paymentMethod.id),
  
  // 결제 금액 및 상태
  amount: decimal('amount', { precision: 19, scale: 4 }).$type<number>().notNull(),
  status: varchar('status', {
    length: 20,
    enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  }).notNull().default('PENDING'),
  
  // 메타데이터
  paymentType: varchar('payment_type', {
    length: 20,
    enum: ['CARD', 'BANK_TRANSFER', 'BNPL', 'REWARD_POINT'],
  }).notNull(),
  description: text('description'),
  metadata: text('metadata'), // JSON 형태로 저장되는 추가 정보
  
  // 시간 정보
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * 결제 이벤트 (PaymentEvent)
 * 결제 과정에서 발생하는 모든 이벤트를 기록합니다.
 * 이벤트 소싱 패턴을 구현하기 위한 핵심 테이블입니다.
 */
export const paymentEvent = pgTable('payment_event', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  
  // 관련 결제 ID
  paymentId: varchar('payment_id', { length: 26 })
    .notNull()
    .references(() => payment.id),
  
  // 이벤트 정보
  eventType: varchar('event_type', {
    length: 30,
    enum: [
      'PAYMENT_REQUESTED',
      'PAYMENT_AUTHORIZED',
      'PAYMENT_CAPTURED',
      'PAYMENT_FAILED',
      'PAYMENT_REFUNDED',
      'PAYMENT_VOIDED',
    ],
  }).notNull(),
  
  // 이벤트 데이터
  amount: decimal('amount', { precision: 19, scale: 4 }).$type<number>().notNull(),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),
  
  // 이벤트 메타데이터
  actor: varchar('actor', {
    length: 20,
    enum: ['USER', 'SYSTEM', 'ADMIN', 'SCHEDULER'],
  }).notNull(),
  reason: text('reason'),
  metadata: text('metadata'), // JSON 형태로 저장되는 추가 정보
  
  // 시간 정보
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 환불 (Refund)
 * 결제에 대한 환불 정보를 저장합니다.
 */
export const refund = pgTable('refund', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  
  // 관련 결제 ID
  paymentId: varchar('payment_id', { length: 26 })
    .notNull()
    .references(() => payment.id),
  
  // 환불 정보
  amount: decimal('amount', { precision: 19, scale: 4 }).$type<number>().notNull(),
  status: varchar('status', {
    length: 20,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
  }).notNull().default('PENDING'),
  
  // 환불 메타데이터
  reason: text('reason'),
  metadata: text('metadata'), // JSON 형태로 저장되는 추가 정보
  
  // 시간 정보
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * 환불 이벤트 (RefundEvent)
 * 환불 과정에서 발생하는 모든 이벤트를 기록합니다.
 */
export const refundEvent = pgTable('refund_event', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  
  // 관련 환불 ID
  refundId: varchar('refund_id', { length: 26 })
    .notNull()
    .references(() => refund.id),
  
  // 이벤트 정보
  eventType: varchar('event_type', {
    length: 30,
    enum: [
      'REFUND_REQUESTED',
      'REFUND_PROCESSED',
      'REFUND_COMPLETED',
      'REFUND_FAILED',
    ],
  }).notNull(),
  
  // 이벤트 데이터
  amount: decimal('amount', { precision: 19, scale: 4 }).$type<number>().notNull(),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),
  
  // 이벤트 메타데이터
  actor: varchar('actor', {
    length: 20,
    enum: ['USER', 'SYSTEM', 'ADMIN'],
  }).notNull(),
  reason: text('reason'),
  metadata: text('metadata'), // JSON 형태로 저장되는 추가 정보
  
  // 시간 정보
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ────────────────────────────────────────────
// 관계 정의 (Relations)
// ────────────────────────────────────────────

// Payment 관계
export const paymentRelations = relations(payment, ({ one, many }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [payment.paymentMethodId],
    references: [paymentMethod.id],
  }),
  events: many(paymentEvent),
  refunds: many(refund),
}));

// PaymentEvent 관계
export const paymentEventRelations = relations(paymentEvent, ({ one }) => ({
  payment: one(payment, {
    fields: [paymentEvent.paymentId],
    references: [payment.id],
  }),
}));

// Refund 관계
export const refundRelations = relations(refund, ({ one, many }) => ({
  payment: one(payment, {
    fields: [refund.paymentId],
    references: [payment.id],
  }),
  events: many(refundEvent),
}));

// RefundEvent 관계
export const refundEventRelations = relations(refundEvent, ({ one }) => ({
  refund: one(refund, {
    fields: [refundEvent.refundId],
    references: [refund.id],
  }),
}));