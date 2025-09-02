// schema.ts (MVP Simplified Enums)
// Comprehensive database schema for payment and BNPL system using Drizzle ORM
// MVP 버전: enum/상태를 단순화하여 서비스/테스트/운영 복잡도 축소

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
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

import { ulid } from 'ulid';
import { getTsid } from 'tsid-ts';

export const newMemberId = (): string => getTsid().toString();

// ───────────────────────────────────────────
// Status Constants - Centralized Status Management (MVP Simplified)
// ────────────────────────────────────────────

/**
 * ✅ 결제 세션(및 최종 결제 상태) - 단일 진실
 * - BNPL의 중간 상태(SETTLEMENT_REQUESTED)는 이벤트로 표현하고 상태로는 유지하지 않음
 */
export const PAYMENT_SESSION_STATUS = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED', // NOTE: 기존 철자 유지 (마이그레이션 회피)
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentSessionStatus = keyof typeof PAYMENT_SESSION_STATUS;

/**
 * ✅ 트랜잭션 상태 (결제 이벤트/BNPL 트랜잭션에서 사용)
 * - MVP에 필요한 최소 상태만 유지
 */
export const TRANSACTION_STATUS = {
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type TransactionStatus = keyof typeof TRANSACTION_STATUS;

/**
 * ✅ 배치 잡 상태 (BNPL 월말 정산 등)
 */
export const BATCH_JOB_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type BatchJobStatus = keyof typeof BATCH_JOB_STATUS;

/**
 * ✅ 결제수단 상태 (단순화)
 */
export const PAYMENT_METHOD_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type PaymentMethodStatus = keyof typeof PAYMENT_METHOD_STATUS;

/**
 * ✅ BNPL 계정 상태 (단순화)
 */
export const BNPL_ACCOUNT_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  OVERDUE: 'OVERDUE',
} as const;
export type BnplAccountStatus = keyof typeof BNPL_ACCOUNT_STATUS;

/**
 * ✅ 환불 상태 (단순화)
 */
export const REFUND_STATUS = {
  REQUESTED: 'REQUESTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = keyof typeof REFUND_STATUS;

/**
 * ✅ 결제 잠금 상태 (그대로 유지)
 */
export const PAYMENT_LOCK_STATUS = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED',
} as const;
export type PaymentLockStatus = keyof typeof PAYMENT_LOCK_STATUS;

/**
 * ✅ 세션 이벤트 타입 (Event Sourcing 최소셋)
 * - LOCK_CREATED, PAYMENT_INITIATED 제거 (MVP에선 불필요)
 */
export const PAYMENT_SESSION_EVENT_TYPE = {
  SESSION_CREATED: 'SESSION_CREATED',
  PAYMENT_AUTHORIZED: 'PAYMENT_AUTHORIZED',
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
} as const;
export type PaymentSessionEventType = keyof typeof PAYMENT_SESSION_EVENT_TYPE;

/**
 * ✅ 아이템포턴시 상태 (그대로 유지)
 */
export const IDEMPOTENCY_STATUS = {
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
} as const;
export type IdempotencyStatus = keyof typeof IDEMPOTENCY_STATUS;

/**
 * ✅ 포인트 트랜잭션 타입 (MVP에 포함, 필요 시 나중에 분리 가능)
 */
export const POINT_TRANSACTION_TYPE = {
  EARN: 'EARN',
  REDEEM: 'REDEEM',
  EARN_CANCEL: 'EARN_CANCEL',
  EXPIRE: 'EXPIRE',
} as const;
export type PointTransactionType = keyof typeof POINT_TRANSACTION_TYPE;

// ────────────────────────────────────────────
// Payment Method Schemas
// ────────────────────────────────────────────

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

export const batchCmsMethod = pgTable(
  'batch_cms_method',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .references(() => paymentMethod.id),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    hmsMemberId: varchar('hms_member_id', { length: 64 }).notNull(),
    hmsCustId: varchar('hms_cust_id', { length: 64 })
      .notNull()
      .default('default-cust'),
    creditLimit: numeric('credit_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    approvedLimit: numeric('approved_limit', { precision: 18, scale: 2 })
      .$type<number>()
      .notNull(),
    billingCycleDay: integer('billing_cycle_day').notNull(),
    hmsMetadata: text('hms_metadata'),
    termsUrl: text('terms_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('idx_hms_member_unique').on(table.hmsMemberId)],
);

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

export const bnplTransaction = pgTable('bnpl_transaction', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  bnplAccountId: varchar('bnpl_account_id', { length: 21 })
    .notNull()
    .references(() => bnplAccount.id),
  paymentSessionId: varchar('payment_session_id', { length: 26 }).notNull(),
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
  status: text('status').$type<BatchJobStatus>().notNull().default('PENDING'),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
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
/** Payment Session Schemas */
// ────────────────────────────────────────────

export const paymentSessions = pgTable(
  'payment_sessions',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
    userId: varchar('user_id', { length: 64 }).notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: varchar('status', { length: 24 })
      .$type<PaymentSessionStatus>()
      .notNull()
      .default('PENDING'),

    // 추가 정보는 metadata로 (JSON string)
    metadata: text('metadata'),
    refundedAmount: numeric('refunded_amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull()
    .default(0),
    // 타임스탬프
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_payment_sessions_status').on(table.status),
    index('idx_payment_sessions_user_id').on(table.userId),
    index('idx_payment_sessions_expires_at').on(table.expiresAt),
  ],
);

export const paymentLocks = pgTable(
  'payment_locks',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
    paymentSessionId: varchar('payment_session_id', { length: 26 })
      .notNull()
      .references(() => paymentSessions.id, { onDelete: 'cascade' }),
    lockToken: varchar('lock_token', { length: 128 }).notNull().unique(),
    deviceFingerprint: varchar('device_fingerprint', { length: 64 }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    status: varchar('status', { length: 20 })
      .$type<PaymentLockStatus>()
      .notNull()
      .default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_active_payment_lock')
      .on(table.paymentSessionId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('idx_payment_locks_expires_at').on(table.expiresAt),
    index('idx_payment_locks_status').on(table.status),
    uniqueIndex('idx_payment_locks_token_unique').on(table.lockToken),
  ],
);

export const paymentSessionEvents = pgTable(
  'payment_session_events',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
    paymentSessionId: varchar('payment_session_id', { length: 26 })
      .notNull()
      .references(() => paymentSessions.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 })
      .$type<PaymentSessionEventType>()
      .notNull(),
    eventData: text('event_data'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_payment_session_events_session_id').on(table.paymentSessionId),
    index('idx_payment_session_events_occurred_at').on(table.occurredAt),
    index('idx_payment_session_events_event_type').on(table.eventType),
  ],
);

// ────────────────────────────────────────────
/** Payment Event Schemas */
// ────────────────────────────────────────────

export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  paymentSessionId: varchar('payment_session_id', { length: 26 })
    .notNull()
    .references(() => paymentSessions.id),
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
  metadata: text('metadata'),
});

// ────────────────────────────────────────────
/** User Refund Account Schemas */
// ────────────────────────────────────────────

export const userRefundAccounts = pgTable(
  'user_refund_accounts',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: varchar('user_id', { length: 64 }).notNull(),
    bankCode: varchar('bank_code', { length: 32 }).notNull(),
    bankName: varchar('bank_name', { length: 64 }).notNull(),
    accountNumber: varchar('account_number', { length: 64 }).notNull(),
    accountHolderName: varchar('account_holder_name', {
      length: 128,
    }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_user_default_refund_account')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

// ────────────────────────────────────────────
/** Refund Event Schemas */
// ────────────────────────────────────────────

export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  paymentEventId: varchar('payment_event_id', { length: 26 })
    .notNull()
    .references(() => paymentEvents.id),
  // ⬇️ notNull 제거 → nullable 허용
  refundAccountId: varchar('refund_account_id', { length: 26 }).references(
    () => userRefundAccounts.id,
  ),
  amount: numeric('amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull(),
  status: varchar('status', { length: 255 }).$type<RefundStatus>().notNull(),
  reason: text('reason'),
  completedBy: varchar('completed_by', { length: 64 }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  metadata: text('metadata'),
});

// ────────────────────────────────────────────
/** Idempotency Schemas */
// ────────────────────────────────────────────

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    requestPath: varchar('request_path', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    status: text('status').$type<IdempotencyStatus>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('idx_idempotency_keys_user_id').on(table.userId),
    index('idx_idempotency_keys_expires_at').on(table.expiresAt),
    index('idx_idempotency_keys_status').on(table.status),
    index('idx_idempotency_keys_user_status').on(table.userId, table.status),
  ],
);

// ────────────────────────────────────────────
/** Point Schemas */
// ────────────────────────────────────────────

export const points = pgTable('points', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  userId: varchar('user_id', { length: 64 }).notNull().unique(),
  balance: integer('balance').notNull().default(0),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const pointTransactions = pgTable('point_transactions', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  pointId: varchar('point_id', { length: 26 })
    .notNull()
    .references(() => points.id),
  type: text('type').$type<PointTransactionType>().notNull(),
  amount: integer('amount').notNull(),
  relatedEventId: varchar('related_event_id', { length: 26 }),
  reason: varchar('reason', { length: 255 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const overdueAccounts = pgTable('overdue_accounts', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
  userId: varchar('user_id', { length: 64 }).notNull(),
  overdueCount: integer('overdue_count').notNull().default(1), // 연체 횟수 누적
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  status: varchar('status', { length: 20 })
    .$type<'ACTIVE' | 'SUSPENDED'>()
    .notNull()
    .default('ACTIVE'),
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
    // paymentSession 관계는 순환 참조 문제로 인해 제거
    // 필요시 서비스 레이어에서 별도 조회
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

// Payment session relations
export const paymentSessionsRelations = relations(
  paymentSessions,
  ({ many }) => ({
    locks: many(paymentLocks),
    events: many(paymentSessionEvents),
    paymentEvents: many(paymentEvents),
    // bnplTransactions 관계는 순환 참조 문제로 인해 제거
    // 필요시 서비스 레이어에서 별도 조회
  }),
);

export const paymentLocksRelations = relations(paymentLocks, ({ one }) => ({
  paymentSession: one(paymentSessions, {
    fields: [paymentLocks.paymentSessionId],
    references: [paymentSessions.id],
  }),
}));

export const paymentSessionEventsRelations = relations(
  paymentSessionEvents,
  ({ one }) => ({
    paymentSession: one(paymentSessions, {
      fields: [paymentSessionEvents.paymentSessionId],
      references: [paymentSessions.id],
    }),
  }),
);

// Payment event relations
export const paymentEventsRelations = relations(
  paymentEvents,
  ({ one, many }) => ({
    paymentSession: one(paymentSessions, {
      fields: [paymentEvents.paymentSessionId],
      references: [paymentSessions.id],
    }),
    paymentMethod: one(paymentMethod, {
      fields: [paymentEvents.paymentMethodId],
      references: [paymentMethod.id],
    }),
    refunds: many(refundEvents),
  }),
);

// User refund account relations
export const userRefundAccountsRelations = relations(
  userRefundAccounts,
  ({ many }) => ({
    refundEvents: many(refundEvents),
  }),
);

// Refund event relations
export const refundEventsRelations = relations(refundEvents, ({ one }) => ({
  paymentEvent: one(paymentEvents, {
    fields: [refundEvents.paymentEventId],
    references: [paymentEvents.id],
  }),
  userRefundAccount: one(userRefundAccounts, {
    fields: [refundEvents.refundAccountId],
    references: [userRefundAccounts.id],
  }),
}));

// Point Relations
export const pointsRelations = relations(points, ({ many }) => ({
  transactions: many(pointTransactions),
}));

export const pointTransactionsRelations = relations(
  pointTransactions,
  ({ one }) => ({
    pointAccount: one(points, {
      fields: [pointTransactions.pointId],
      references: [points.id],
    }),
  }),
);
