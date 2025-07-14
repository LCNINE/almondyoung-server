import {
  bigint,
  decimal,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { paymentMethod, bnplAccount } from '../payment-method/schema';
import { invoice } from '../invoice/schema';

/**
 * 결제 이벤트 (PaymentEvent)
 * PG사를 통한 실제 결제의 생성, 성공, 실패 상태를 기록하는 핵심 테이블입니다.
 * 모든 결제 시도는 이 테이블에 기록됩니다.
 */
export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),

  // 외부 'Invoice' 모듈의 청구서 ID를 참조합니다.
  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => invoice.id),

  // 외부 'PaymentMethod' 모듈의 결제수단 ID를 참조합니다.
  paymentMethodId: varchar('payment_method_id', { length: 26 })
    .notNull()
    .references(() => paymentMethod.id),

  amount: decimal('amount', { precision: 19, scale: 4 }).notNull(),
  status: varchar('status', {
    length: 255,
    enum: [
      'REQUESTED',
      'AUTHORIZED',
      'CAPTURED',
      'FAILED',
      'DUPLICATE_ATTEMPT',
    ],
  }).notNull(),

  // PG사로부터 받은 고유 거래 ID
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),

  actor: varchar('actor', {
    length: 255,
    enum: ['USER', 'SCHEDULER', 'ADMIN'],
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
/**
 * 환불 이벤트 (RefundEvent)
 * 성공한 결제(PaymentEvent)에 대한 환불 처리 상태를 기록합니다.
 */
export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),

  // 같은 모듈 내의 'payment_events' 테이블을 참조합니다.
  paymentEventId: varchar('payment_event_id', { length: 26 })
    .notNull()
    .references(() => paymentEvents.id),

  amount: decimal('amount', { precision: 19, scale: 4 }).notNull(),
  status: varchar('status', {
    length: 255,
    enum: ['REQUESTED', 'SUCCESS', 'FAILED'],
  }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// --- 관계 정의 ---

export const paymentEventsRelations = relations(
  paymentEvents,
  ({ many, one }) => ({
    // 하나의 결제는 여러 번의 환불(부분 환불)을 가질 수 있습니다.
    refunds: many(refundEvents),

    // 결제수단과의 관계
    paymentMethod: one(paymentMethod, {
      fields: [paymentEvents.paymentMethodId],
      references: [paymentMethod.id],
    }),
    // 청구서와의 관계
    invoice: one(invoice, {
      fields: [paymentEvents.invoiceId],
      references: [invoice.id],
    }),
  }),
);

export const refundEventsRelations = relations(refundEvents, ({ one }) => ({
  // 하나의 환불은 반드시 하나의 원본 결제를 가집니다.
  paymentEvent: one(paymentEvents, {
    fields: [refundEvents.paymentEventId],
    references: [paymentEvents.id],
  }),
}));

// ────────────────────────────────────────────
// BNPL Transaction (BNPL 거래 내역)
// ────────────────────────────────────────────
export const bnplTransaction = pgTable('bnpl_transaction', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 26 })
    .notNull()
    .references(() => bnplAccount.id),
  invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
  transactionType: text('transaction_type')
    .$type<'DEBIT' | 'CREDIT'>()
    .notNull(),
  status: text('status')
    .$type<'AUTHORIZED' | 'CAPTURED' | 'VOIDED'>()
    .notNull(),
  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// BNPL Transaction Relations
// ────────────────────────────────────────────
export const bnplTransactionRelations = relations(
  bnplTransaction,
  ({ one }) => ({
    bnplAccount: one(bnplAccount, {
      fields: [bnplTransaction.bnplAccountId],
      references: [bnplAccount.id],
    }),
    invoice: one(invoice, {
      fields: [bnplTransaction.invoiceId],
      references: [invoice.id],
    }),
  }),
);

// ────────────────────────────────────────────
// Settlement Batch (월별 정산 배치)
// ────────────────────────────────────────────
export const settlementBatch = pgTable('settlement_batch', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 26 })
    .notNull()
    .references(() => bnplAccount.id),
  batchNumber: varchar('batch_number', { length: 50 }).notNull(), // 예: "2025-07"
  totalAmount: decimal('total_amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull()
    .default(0),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: text('status')
    .$type<'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED'>()
    .notNull()
    .default('PENDING'),
  batchPeriodStart: timestamp('batch_period_start', {
    withTimezone: true,
  }).notNull(),
  batchPeriodEnd: timestamp('batch_period_end', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Settlement Batch Item (배치 내 개별 거래)
// ────────────────────────────────────────────
export const settlementBatchItem = pgTable('settlement_batch_item', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => nanoid()),
  batchId: varchar('batch_id', { length: 26 })
    .notNull()
    .references(() => settlementBatch.id),
  bnplTransactionId: varchar('bnpl_transaction_id', { length: 26 })
    .notNull()
    .references(() => bnplTransaction.id),
  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  transactionDate: timestamp('transaction_date', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Settlement Batch Relations
// ────────────────────────────────────────────
export const settlementBatchRelations = relations(
  settlementBatch,
  ({ one, many }) => ({
    bnplAccount: one(bnplAccount, {
      fields: [settlementBatch.bnplAccountId],
      references: [bnplAccount.id],
    }),
    items: many(settlementBatchItem),
  }),
);

// ────────────────────────────────────────────
// Settlement Batch Item Relations
// ────────────────────────────────────────────
export const settlementBatchItemRelations = relations(
  settlementBatchItem,
  ({ one }) => ({
    settlementBatch: one(settlementBatch, {
      fields: [settlementBatchItem.batchId],
      references: [settlementBatch.id],
    }),
    bnplTransaction: one(bnplTransaction, {
      fields: [settlementBatchItem.bnplTransactionId],
      references: [bnplTransaction.id],
    }),
  }),
);
