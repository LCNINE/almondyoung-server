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
// Status Constants - Centralized Status Management
// ────────────────────────────────────────────

// 🎯 그룹 1: 금융 거래 상태 (Financial Transaction Status)
// 적용 대상: paymentEvents, bnplTransaction
// 역할: 실제 돈의 흐름을 나타내는 일관된 상태
export const FINANCIAL_TRANSACTION_STATUS = {
  AUTHORIZED: 'AUTHORIZED',           // 내부 승인 완료 / PG사 예약 접수 완료
  SETTLEMENT_REQUESTED: 'SETTLEMENT_REQUESTED', // 정산(출금) 요청됨
  CAPTURED: 'CAPTURED',               // 최종 출금 성공 (수금 완료)
  FAILED: 'FAILED',                   // 최종 출금 실패
} as const;
export type FinancialTransactionStatus = keyof typeof FINANCIAL_TRANSACTION_STATUS;

// 🎯 그룹 2: 배치 작업 상태 (Batch Job Status)
// 적용 대상: settlementBatch
// 역할: 백그라운드 작업의 진행 상태를 나타내는 명확한 상태
export const BATCH_JOB_STATUS = {
  PENDING: 'PENDING',                 // 배치 작업 대기 중
  PROCESSING: 'PROCESSING',           // 배치 작업 처리 중
  COMPLETED: 'COMPLETED',             // 배치 작업 성공적으로 완료
  FAILED: 'FAILED',                   // 배치 작업 실패
  CANCELLED: 'CANCELLED',             // 관리자에 의해 취소됨
} as const;
export type BatchJobStatus = keyof typeof BATCH_JOB_STATUS;

// 🎯 그룹 3: 고유 엔티티 상태 (Unique Entity Status)
// 각 엔티티의 독립적인 생명주기를 나타내는 상태들

// 결제수단 상태
export const PAYMENT_METHOD_STATUS = {
  PENDING: 'PENDING',                 // 등록 처리 중
  ACTIVE: 'ACTIVE',                   // 활성화됨
  FAILED: 'FAILED',                   // 등록 실패
  INACTIVE: 'INACTIVE',               // 비활성화됨
  DELETED: 'DELETED',                 // 삭제됨
} as const;
export type PaymentMethodStatus = keyof typeof PAYMENT_METHOD_STATUS;

// BNPL 계정 상태
export const BNPL_ACCOUNT_STATUS = {
  ACTIVE: 'ACTIVE',                   // 정상 활성화
  INACTIVE: 'INACTIVE',               // 비활성화
  OVERDUE: 'OVERDUE',                 // 연체 상태
  SUSPENDED: 'SUSPENDED',             // 일시 정지
} as const;
export type BnplAccountStatus = keyof typeof BNPL_ACCOUNT_STATUS;

// 청구서 상태
export const INVOICE_STATUS = {
  ISSUED: 'ISSUED',                   // 발행됨
  PAID: 'PAID',                       // 결제 완료
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', // 부분 환불
  REFUNDED: 'REFUNDED',               // 전액 환불
  CANCELLED: 'CANCELLED',             // 취소됨
  EXPIRED: 'EXPIRED',                 // 만료됨
  OVERDUE: 'OVERDUE',                 // 연체됨
  FAILED: 'FAILED',                   // 결제 실패
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS;

// 💸 환불 상태 (refundEvents)
export const REFUND_STATUS = {
  REQUESTED: 'REQUESTED',             // 환불 요청됨
  PROCESSING: 'PROCESSING',           // CS팀 처리 중 (수동 확인/입금)
  COMPLETED: 'COMPLETED',             // 최종 환불 완료
  FAILED: 'FAILED',                   // 환불 처리 실패
  REJECTED: 'REJECTED',               // 환불 요청 거절
} as const;
export type RefundStatus = keyof typeof REFUND_STATUS;

// 📋 Invoice 이벤트 타입 (Invoice Event Sourcing)
export const INVOICE_EVENT_TYPE = {
  INVOICE_ISSUED: 'INVOICE_ISSUED',                     // 청구서 생성
  INVOICE_PAID: 'INVOICE_PAID',                         // 결제 완료 (CAPTURED)
  INVOICE_FAILED: 'INVOICE_FAILED',                     // 결제 실패 (FAILED)
  INVOICE_PARTIALLY_REFUNDED: 'INVOICE_PARTIALLY_REFUNDED', // 부분 환불 완료
  INVOICE_FULLY_REFUNDED: 'INVOICE_FULLY_REFUNDED',     // 전액 환불 완료
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',               // 주문 취소
  INVOICE_MARKED_AS_OVERDUE: 'INVOICE_MARKED_AS_OVERDUE', // 연체 처리
} as const;
export type InvoiceEventType = keyof typeof INVOICE_EVENT_TYPE;

// 🔄 하위 호환성을 위한 별칭 (기존 코드와의 호환성 유지)
export const TRANSACTION_STATUS = FINANCIAL_TRANSACTION_STATUS;
export type TransactionStatus = FinancialTransactionStatus;

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
      .$type<PaymentMethodStatus>()
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
      .$type<BnplAccountStatus>()
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
    .$type<BatchJobStatus>()
    .notNull()
    .default('PENDING'),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }), // HMS에서 받은 배치 거래 ID
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
    .$type<RefundStatus>()
    .notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }), // CS팀 환불 완료 시점
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

// Payment event relations
export const paymentEventsRelations = relations(paymentEvents, ({ one, many }) => ({
  invoice: one(invoice, {
    fields: [paymentEvents.invoiceId],
    references: [invoice.id],
  }),
  paymentMethod: one(paymentMethod, {
    fields: [paymentEvents.paymentMethodId],
    references: [paymentMethod.id],
  }),
  refunds: many(refundEvents),
}));

// Refund event relations
export const refundEventsRelations = relations(refundEvents, ({ one }) => ({
  paymentEvent: one(paymentEvents, {
    fields: [refundEvents.paymentEventId],
    references: [paymentEvents.id],
  }),
}));

// ────────────────────────────────────────────
// Zod Schemas for Validation
// ────────────────────────────────────────────
