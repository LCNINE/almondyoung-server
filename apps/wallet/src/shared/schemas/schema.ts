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
  bigserial,
  decimal,
  boolean,
  uniqueIndex,
  foreignKey,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { ulid } from 'ulid';

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

// ────────────────────────────────────────────
// Payment Method Schemas
// ────────────────────────────────────────────

// Core payment method schema
export const paymentMethod = pgTable(
  'payment_method',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    methodType: text('method_type')
      .$type<'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT'>()
      .notNull(),
    methodName: varchar('method_name', { length: 64 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    institutionCode: varchar('institution_code', { length: 32 }).notNull(),
    status: text('status').$type<'ACTIVE' | 'INACTIVE' | 'DELETED'>().notNull(),
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

// Card-specific payment method details
export const cardMethod = pgTable(
  'card_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
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
      .$defaultFn(() => nanoid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    approvedLimit: numeric('approved_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    currentBalance: numeric('current_balance', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull()
      .default(0),
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
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    bnplAccountId: varchar('bnpl_account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccount.id),
    eventType: text('event_type')
      .$type<'ACTIVATED' | 'DEACTIVATED'>()
      .notNull(),
    actor: text('actor').$type<'USER' | 'ADMIN' | 'SYSTEM'>().notNull(),
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
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<string>()
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
    .$defaultFn(() => nanoid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 26 })
    .notNull()
    .references(() => bnplAccount.id),
  batchNumber: varchar('batch_number', { length: 50 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 19, scale: 4 })
    .$type<string>()
    .notNull()
    .default('0'),
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

// Settlement batch items linking transactions to batches
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
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<string>()
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
      | 'ITEM_SUCCESS'
      | 'ITEM_FAILED'
      | 'BATCH_COMPLETED'
      | 'BATCH_FAILED'
    >()
    .notNull(),
  status: varchar('status', { length: 50 })
    .$type<'PROCESSING' | 'SUCCESS' | 'FAILED'>()
    .notNull(),
  paymentEventId: varchar('payment_event_id', { length: 26 }),
  errorMessage: text('error_message'),
  metadata: text('metadata'),
  actor: varchar('actor', { length: 255 })
    .$type<'SCHEDULER' | 'ADMIN' | 'SYSTEM'>()
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
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 64 }).notNull(),
  invoiceType: varchar('invoice_type', { length: 32 }).notNull(),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  refundedAmount: decimal('refunded_amount', { precision: 18, scale: 2 })
    .notNull()
    .default('0'),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().$type<InvoiceStatus>(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Invoice events
export const invoiceEvent = pgTable('invoice_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventUuid: varchar('event_uuid', { length: 64 }).notNull(),
  invoiceId: bigint('invoice_id', { mode: 'number' })
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
  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => invoice.id),
  paymentMethodId: varchar('payment_method_id', { length: 26 })
    .notNull()
    .references(() => paymentMethod.id),
  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<string>()
    .notNull(),
  status: varchar('status', { length: 255 })
    .$type<'REQUESTED' | 'SUCCESS' | 'FAILED' | 'DUPLICATE_ATTEMPT'>()
    .notNull(),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),
  actor: varchar('actor', { length: 255 })
    .$type<'USER' | 'SCHEDULER' | 'ADMIN'>()
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Refund events
export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  paymentEventId: varchar('payment_event_id', { length: 26 })
    .notNull()
    .references(() => paymentEvents.id),
  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<string>()
    .notNull(),
  status: varchar('status', { length: 255 })
    .$type<'REQUESTED' | 'SUCCESS' | 'FAILED'>()
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
}));

export const cardMethodRelations = relations(cardMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [cardMethod.id],
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
