// schema.ts
// Comprehensive database schema for payment and BNPL system using Drizzle ORM
// Organized by entity groups with clear separation of concerns

import {
  pgTable,
  varchar,
  bigint,
  numeric,
  text,
  timestamp,
  integer,
  boolean,
  uniqueIndex,
  foreignKey,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

import { ulid } from 'ulid';
import { getTsid } from 'tsid-ts';

export const newMemberId = (): string => getTsid().toString();

// ───────────────────────────────────────────
// Constants and Types
// ────────────────────────────────────────────

export const INVOICE_STATUS = {
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  OVERDUE: 'OVERDUE',
  FAILED: 'FAILED',
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS;

// ✅ (개선) 거래 및 이벤트의 생명주기를 나타내는 표준 상태를 상수로 정의합니다.
//    이것이 사용자께서 말씀하신 '상속/재사용'에 해당합니다.
export const TRANSACTION_STATUS = {
  AUTHORIZED: 'AUTHORIZED', // 내부 승인 완료 / PG사 예약 접수 완료
  REQUESTED: 'REQUESTED', // 정산 요청됨 (배치 처리 시작)
  CAPTURED: 'CAPTURED', // 최종 출금 성공 (수금 완료)
  FAILED: 'FAILED', // 최종 출금 실패
} as const;
export type TransactionStatus = keyof typeof TRANSACTION_STATUS;

// ────────────────────────────────────────────
// Payment Method Schemas
// ────────────────────────────────────────────

// Core payment method schema
export const paymentMethod = pgTable(
  'payment_method',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: varchar('user_id', { length: 64 }).notNull(),
    methodType: text('method_type')
      .$type<'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT'>()
      .notNull(),
    methodName: varchar('method_name', { length: 64 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    institutionCode: varchar('institution_code', { length: 32 }).notNull(),
    status: text('status')
      .$type<'PENDING' | 'ACTIVE' | 'FAILED' | 'INACTIVE' | 'DELETED'>()
      .notNull()
      .default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_user_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    unique('uq_payment_method_id_type').on(table.id, table.methodType),
  ],
);

// BatchCMS (HMS BNPL) 전용 테이블
export const batchCmsMethod = pgTable(
  'batch_cms_method',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .references(() => paymentMethod.id),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    // BatchCMS (HMS) 고유 필드
    hmsMemberId: varchar('hms_member_id', { length: 64 }).notNull(),
    hmsCustId: varchar('hms_cust_id', { length: 64 })
      .notNull()
      .default('default-cust'),

    // BNPL 관련 정보
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    approvedLimit: numeric('approved_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    billingCycleDay: integer('billing_cycle_day').notNull(),

    // BatchCMS 메타데이터
    hmsMetadata: text('hms_metadata'), // JSON 형태로 HMS 응답 원본 저장
    termsUrl: text('terms_url'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('idx_hms_member_unique').on(table.hmsMemberId)],
);

// Card-specific payment method details (기존 유지 - 향후 Toss 등 추가 예정)
export const cardMethod = pgTable(
  'card_method',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    methodType: text('method_type').notNull().default('CARD'),
    pgToken: varchar('pg_token', { length: 128 }).notNull(),
    billingKey: varchar('billing_key', { length: 128 }).notNull(),
    maskedCardNumber: varchar('masked_card_number', { length: 32 }).notNull(),
    lastFourDigits: varchar('last_four_digits', { length: 4 }),
    cardBrand: varchar('card_brand', { length: 32 }),
    cardType: varchar('card_type', { length: 32 }),
    issuerName: varchar('issuer_name', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_card_billing_key_unique').on(table.billingKey),
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_card_method_payment_method',
    }).onDelete('cascade'),
  ],
);

// ────────────────────────────────────────────
// BNPL Schemas
// ────────────────────────────────────────────

// BNPL account details
export const bnplAccount = pgTable(
  'bnpl_account',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => newMemberId()),
    userId: varchar('user_id', { length: 64 }).notNull(),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    approvedLimit: numeric('approved_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),

    status: text('status')
      .$type<'ACTIVE' | 'INACTIVE' | 'OVERDUE' | 'SUSPENDED'>()
      .notNull()
      .default('ACTIVE'),
    billingCycleDay: integer('billing_cycle_day').notNull(),
    termsUrl: text('terms_url'),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('idx_bnpl_account_user_unique').on(table.userId)],
);

// BNPL activation events
export const bnplActivationEvent = pgTable(
  'bnpl_activation_event',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    bnplAccountId: varchar('bnpl_account_id', { length: 21 })
      .notNull()
      .references(() => bnplAccount.id),
    eventType: text('event_type')
      .$type<'ACTIVATED' | 'DEACTIVATED'>()
      .notNull(),
    actor: text('actor')
      .$type<'USER' | 'ADMIN' | 'SYSTEM' | 'SCHEDULER'>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_bnpl_activation_payment_method').on(table.paymentMethodId),
  ],
);

// BNPL transactions
export const bnplTransaction = pgTable('bnpl_transaction', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 21 })
    .notNull()
    .references(() => bnplAccount.id),
  invoiceId: varchar('invoice_id', { length: 64 }).notNull(),
  transactionType: text('transaction_type')
    .$type<'DEBIT' | 'CREDIT'>()
    .notNull(),
  status: text('status').$type<TransactionStatus>().notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Settlement Schemas
// ────────────────────────────────────────────

// Settlement batch for aggregating transactions
export const settlementBatch = pgTable('settlement_batch', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 21 })
    .notNull()
    .references(() => bnplAccount.id),
  batchNumber: varchar('batch_number', { length: 50 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull()
    .default(0),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: text('status')
    .$type<'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'CANCELLED'>()
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

// Settlement batch items linking transactions to batches
export const settlementBatchItem = pgTable('settlement_batch_item', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  batchId: varchar('batch_id', { length: 26 })
    .notNull()
    .references(() => settlementBatch.id),
  bnplTransactionId: varchar('bnpl_transaction_id', { length: 26 })
    .notNull()
    .references(() => bnplTransaction.id),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  transactionDate: timestamp('transaction_date', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Settlement process events
export const settlementProcessEvent = pgTable('settlement_process_event', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  batchId: varchar('batch_id', { length: 26 })
    .notNull()
    .references(() => settlementBatch.id),
  batchItemId: varchar('batch_item_id', { length: 26 }).references(
    () => settlementBatchItem.id,
  ),
  eventType: varchar('event_type', { length: 50 })
    .$type<
      | 'BATCH_STARTED'
      | 'ITEM_PROCESSING'
      | 'ITEM_AUTHORIZED'
      | 'ITEM_CAPTURED'
      | 'ITEM_FAILED'
      | 'BATCH_COMPLETED'
      | 'BATCH_FAILED'
    >()
    .notNull(),
  status: varchar('status', { length: 50 })
    .$type<'PROCESSING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'>()
    .notNull(),
  paymentEventId: varchar('payment_event_id', { length: 26 }),
  errorMessage: text('error_message'),
  metadata: text('metadata'),
  actor: varchar('actor', { length: 255 })
    .$type<'SCHEDULER' | 'ADMIN' | 'SYSTEM' | 'USER'>()
    .notNull()
    .default('SCHEDULER'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Invoice Schemas
// ────────────────────────────────────────────

// Invoice details
export const invoice = pgTable('invoice', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  userId: varchar('user_id', { length: 64 }).notNull(),
  invoiceType: varchar('invoice_type', { length: 32 }).notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  refundedAmount: numeric('refunded_amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull()
    .default(0),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().$type<InvoiceStatus>(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Invoice events
export const invoiceEvent = pgTable('invoice_event', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  eventUuid: varchar('event_uuid', { length: 64 }).notNull(),
  invoiceId: varchar('invoice_id', { length: 26 })
    .notNull()
    .references(() => invoice.id),
  eventType: varchar('event_type', { length: 32 }).notNull(),
  reason: varchar('reason', { length: 255 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Payment Event Schemas
// ────────────────────────────────────────────

// Payment events
export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  invoiceId: varchar('invoice_id', { length: 26 })
    .notNull()
    .references(() => invoice.id),
  paymentMethodId: varchar('payment_method_id', { length: 26 })
    .notNull()
    .references(() => paymentMethod.id),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  status: varchar('status', { length: 255 })
    .$type<TransactionStatus>()
    .notNull(),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),
  actor: varchar('actor', { length: 255 })
    .$type<'USER' | 'SCHEDULER' | 'ADMIN' | 'SYSTEM'>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  errorMessage: varchar('error_message', { length: 255 }),
  metadata: text('metadata'), // Event Sourcing을 위한 메타데이터 (JSON 문자열)
});

// Refund events
export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  paymentEventId: varchar('payment_event_id', { length: 26 })
    .notNull()
    .references(() => paymentEvents.id),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  status: varchar('status', { length: 255 })
    .$type<'REQUESTED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED'>()
    .notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// Relations
// ────────────────────────────────────────────

// Payment method relations
export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({
  card: one(cardMethod, {
    fields: [paymentMethod.id],
    references: [cardMethod.id],
  }),
  batchCms: one(batchCmsMethod, {
    fields: [paymentMethod.id],
    references: [batchCmsMethod.id],
  }),
}));

export const cardMethodRelations = relations(cardMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [cardMethod.id],
    references: [paymentMethod.id],
  }),
}));

export const batchCmsMethodRelations = relations(batchCmsMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [batchCmsMethod.id],
    references: [paymentMethod.id],
  }),
}));

// BNPL relations
export const bnplAccountRelations = relations(bnplAccount, ({ many }) => ({
  activationEvents: many(bnplActivationEvent),
  transactions: many(bnplTransaction),
  settlementBatches: many(settlementBatch),
}));

export const bnplActivationEventRelations = relations(
  bnplActivationEvent,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [bnplActivationEvent.paymentMethodId],
      references: [paymentMethod.id],
    }),
    bnplAccount: one(bnplAccount, {
      fields: [bnplActivationEvent.bnplAccountId],
      references: [bnplAccount.id],
    }),
  }),
);

export const bnplTransactionRelations = relations(
  bnplTransaction,
  ({ one, many }) => ({
    bnplAccount: one(bnplAccount, {
      fields: [bnplTransaction.bnplAccountId],
      references: [bnplAccount.id],
    }),
    invoice: one(invoice, {
      fields: [bnplTransaction.invoiceId],
      references: [invoice.id],
    }),
    settlementBatchItems: many(settlementBatchItem),
  }),
);

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

export const settlementProcessEventRelations = relations(
  settlementProcessEvent,
  ({ one }) => ({
    settlementBatch: one(settlementBatch, {
      fields: [settlementProcessEvent.batchId],
      references: [settlementBatch.id],
    }),
    settlementBatchItem: one(settlementBatchItem, {
      fields: [settlementProcessEvent.batchItemId],
      references: [settlementBatchItem.id],
    }),
  }),
);

// Invoice relations
export const invoiceRelations = relations(invoice, ({ many }) => ({
  events: many(invoiceEvent),
}));

export const invoiceEventRelations = relations(invoiceEvent, ({ one }) => ({
  invoice: one(invoice, {
    fields: [invoiceEvent.invoiceId],
    references: [invoice.id],
  }),
}));

// ────────────────────────────────────────────
// Zod Schemas for Validation
// ────────────────────────────────────────────
