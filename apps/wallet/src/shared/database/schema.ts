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

import { getTsid } from 'tsid-ts';
import { generateUUIDv7 } from '../utils/id-generator';

export const newMemberId = (): string => getTsid().toString();

// ✅ 타입 안전한 가격 스냅샷 표현
export type PricingSnapshot = {
  originalAmount?: number;
  discountAmount?: number;
  couponId?: string;
  discountRate?: number;
};

// ───────────────────────────────────────────
// Status Constants - Centralized Status Management (MVP Simplified)
// ────────────────────────────────────────────

/**
 * ✅ 결제 Intent 타입 (v4 아키텍처)
 */
export const PAYMENT_INTENT_TYPE = {
  ORDER: 'ORDER', // 일반 주문 결제
  BNPL_CAPTURE: 'BNPL_CAPTURE', // BNPL 월말 캡처 (CMS 전용)
  MEMBERSHIP_FEE: 'MEMBERSHIP_FEE', // 멤버십 정기결제
} as const;
export type PaymentIntentType = keyof typeof PAYMENT_INTENT_TYPE;

/**
 * ✅ 결제 Provider (v4 아키텍처)
 */
export const PAYMENT_PROVIDER = {
  TOSS: 'TOSS',
  KAKAOPAY: 'KAKAOPAY',
  CMS: 'CMS',
  BNPL: 'BNPL',
  POINTS: 'POINTS',
} as const;
export type PaymentProvider = keyof typeof PAYMENT_PROVIDER;

/**
 * ✅ 결제수단 종류 (stored vs ephemeral)
 */
export const INSTRUMENT_KIND = {
  STORED: 'STORED', // 저장형 (Profile 기반)
  EPHEMERAL: 'EPHEMERAL', // 일시형 (세션 중 승인키)
} as const;
export type InstrumentKind = keyof typeof INSTRUMENT_KIND;

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
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED', // 부분 환불 상태 추가
  REFUNDED: 'REFUNDED', // 전액 환불
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
export const PAYMENT_PROFILE_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type PaymentProfileStatus = keyof typeof PAYMENT_PROFILE_STATUS;

/**
 * ✅ 결제수단 용도 (구독/구매 구분)
 */
export const PAYMENT_PURPOSE = {
  SUBSCRIPTION: 'SUBSCRIPTION', // 멤버십 구독 결제 전용
  PURCHASE: 'PURCHASE', // 상품 구매 결제 전용
  BOTH: 'BOTH', // 구독/구매 모두 가능
} as const;
export type PaymentPurpose = keyof typeof PAYMENT_PURPOSE;

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
  REQUESTED: 'REQUESTED', // 외부에서 환불 요청 접수됨
  APPROVED: 'APPROVED', // 외부에서 승인되어 실행 대기중
  COMPLETED: 'COMPLETED', // 실제 환급 완료
  CANCELLED: 'CANCELLED', // 환불 취소됨
  FAILED: 'FAILED', // 환급 실행 실패
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
  REFUND_REQUESTED: 'REFUND_REQUESTED', // 환불 요청 시작
  REFUND_COMPLETED: 'REFUND_COMPLETED', // 환불 완료
  REFUND_FAILED: 'REFUND_FAILED', // 환불 실패 추가
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
// Payment Method Schemas - 정규화된 구조 (민감값 저장 금지)
// ────────────────────────────────────────────

/** 공통 결제 프로필(추상 슬롯) */
export const paymentProfiles = pgTable(
  'payment_profiles',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),
    userId: varchar('user_id', { length: 64 }).notNull(),

    provider: varchar('provider', { length: 16 })
      .$type<'CMS'>()
      .notNull()
      .default('CMS'),

    // CMS 카드 / CMS 배치(계좌)
    kind: varchar('kind', { length: 16 }).$type<'CARD' | 'BATCH'>().notNull(),

    status: varchar('status', { length: 16 })
      .$type<'PENDING' | 'ACTIVE' | 'INACTIVE'>()
      .notNull()
      .default('PENDING'),

    // UI 라벨(예: "CMS 카드", "신한 **89")
    name: varchar('name', { length: 64 }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_payment_profiles_user').on(table.userId),
    index('idx_payment_profiles_provider_kind').on(table.provider, table.kind),
  ],
);

/** 효성 CMS — 신용카드(TE-0040) 최소 + UX 요약 */
export const cmsCardProfiles = pgTable(
  'cms_card_profiles',
  {
    // 공통 프로필과 1:1
    id: varchar('id', { length: 26 })
      .primaryKey()
      .references(() => paymentProfiles.id, { onDelete: 'cascade' }),

    /** 필수 키(효성 API 호출/결정 핵심) */
    memberId: varchar('member_id', { length: 20 }).notNull().unique(),

    /** 상태 요약(신청대기/신청중/신청실패/신청완료 등) */
    cmsStatus: varchar('cms_status', { length: 16 }).notNull(),

    /** (선택) 카드사/기관 코드 3자리—문의 추적용 */
    paymentCompany: varchar('payment_company', { length: 3 }),

    /** ── 운영/UX 요약(민감값 금지) ── */
    cardLast4: varchar('card_last4', { length: 4 }), // 예: "4444"
    cardBrand: varchar('card_brand', { length: 32 }), // 예: "SHINHAN"|"VISA" 등 요약
    payerName: varchar('payer_name', { length: 64 }), // 운영 편의용 표시(필수 아님)
    phoneMask: varchar('phone_mask', { length: 20 }), // 예: "010****5678"
    billingDay: integer('billing_day'), // 1~31 권장(검증은 서비스에서)

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_cms_card_member').on(table.memberId),
    index('idx_cms_card_status').on(table.cmsStatus),
  ],
);

/** 효성 배치 CMS(TE-0046) 최소 + UX 요약 */
export const cmsBatchProfiles = pgTable(
  'cms_batch_profiles',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .references(() => paymentProfiles.id, { onDelete: 'cascade' }),

    memberId: varchar('member_id', { length: 20 }).notNull().unique(),
    cmsStatus: varchar('cms_status', { length: 16 }).notNull(),

    paymentCompany: varchar('payment_company', { length: 3 }),
    payerName: varchar('payer_name', { length: 64 }),
    phoneMask: varchar('phone_mask', { length: 20 }),
    billingDay: integer('billing_day'),

    // 🔽 BNPL 전용 동의서 상태
    consentId: varchar('consent_id', { length: 36 }),
    agreementKey: varchar('agreement_key', { length: 36 }),
    agreementKind: varchar('agreement_kind', { length: 8 }),
    consentStatus: varchar('consent_status', { length: 16 }), // PENDING / AWAITING / REVIEW / APPROVED / REJECTED
    consentSubmittedAt: timestamp('consent_submitted_at', {
      withTimezone: true,
    }),
    consentReviewedAt: timestamp('consent_reviewed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_cms_batch_member').on(t.memberId),
    index('idx_cms_batch_status').on(t.cmsStatus),
    index('idx_cms_batch_consent_status').on(t.consentStatus),
  ],
);

// ────────────────────────────────────────────
// BNPL Schemas
// ────────────────────────────────────────────

export const bnplAccounts = pgTable(
  'bnpl_account',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => newMemberId()),
    userId: varchar('user_id', { length: 64 }).notNull(),
    paymentProfileId: varchar('payment_profile_id', { length: 26 })
      .notNull()
      .references(() => paymentProfiles.id),
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

export const bnplActivationEvents = pgTable(
  'bnpl_activation_event',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),
    paymentProfileId: varchar('payment_profile_id', { length: 26 })
      .notNull()
      .references(() => paymentProfiles.id),
    bnplAccountId: varchar('bnpl_account_id', { length: 21 })
      .notNull()
      .references(() => bnplAccounts.id),
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
    uniqueIndex('idx_bnpl_activation_payment_profile').on(
      table.paymentProfileId,
    ),
  ],
);

export const bnplEvents = pgTable('bnpl_eventss', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateUUIDv7()),
  bnplAccountId: varchar('bnpl_account_id', { length: 21 })
    .notNull()
    .references(() => bnplAccounts.id),
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
// BNPL Invoice & Collection Schemas (리뉴얼.md 기준 물리테이블)
// ────────────────────────────────────────────

export const bnplInvoices = pgTable('bnpl_invoices', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateUUIDv7()),
  bnplAccountId: varchar('bnpl_account_id', { length: 21 })
    .notNull()
    .references(() => bnplAccounts.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 19, scale: 4 })
    .$type<number>()
    .notNull()
    .default(0),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: text('status').$type<BatchJobStatus>().notNull().default('PENDING'),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  periodStart: timestamp('period_start', {
    withTimezone: true,
  }).notNull(),
  periodEnd: timestamp('period_end', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const bnplInvoiceItems = pgTable('bnpl_invoice_items', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateUUIDv7()),
  invoiceId: varchar('invoice_id', { length: 26 })
    .notNull()
    .references(() => bnplInvoices.id),
  bnplEventId: varchar('bnpl_event_id', { length: 26 })
    .notNull()
    .references(() => bnplEvents.id),
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

export const bnplCollectionEvents = pgTable('bnpl_collection_events', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),
  invoiceId: varchar('invoice_id', { length: 26 })
    .notNull()
    .references(() => bnplInvoices.id),
  invoiceItemId: varchar('invoice_item_id', { length: 26 }).references(
    () => bnplInvoiceItems.id,
  ),
  eventType: varchar('event_type', { length: 50 })
    .$type<
      | 'COLLECTION_STARTED'
      | 'ITEM_PROCESSING'
      | 'ITEM_AUTHORIZED'
      | 'ITEM_CAPTURED'
      | 'ITEM_FAILED'
      | 'COLLECTION_COMPLETED'
      | 'COLLECTION_FAILED'
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
/** Payment Session Schemas (PaymentIntent 의미) */
// ────────────────────────────────────────────

// export const paymentSessionss = pgTable(
//   'payment_sessions',
//   {
//     id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
//     userId: varchar('user_id', { length: 64 }).notNull(),
//     amount: numeric('amount', { precision: 19, scale: 4 })
//       .$type<number>()
//       .notNull(),
//     currency: varchar('currency', { length: 3 }).notNull(),
//     status: varchar('status', { length: 24 })
//       .$type<PaymentSessionStatus>()
//       .notNull()
//       .default('PENDING'),

//     // v4 아키텍처: Intent 의미 보강
//     type: varchar('type', { length: 32 })
//       .$type<PaymentIntentType>()
//       .notNull()
//       .default('ORDER'),
//     allowedProviders: text('allowed_providers'), // JSON 배열 ['TOSS','KAKAOPAY','CMS','BNPL','POINTS']

//     // 추가 정보는 metadata로 (JSON string)
//     metadata: text('metadata'),
//     refundedAmount: numeric('refunded_amount', { precision: 19, scale: 4 })
//       .$type<number>()
//       .notNull()
//       .default(0),
//     // 타임스탬프
//     expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
//     authorizedAt: timestamp('authorized_at', { withTimezone: true }),
//     capturedAt: timestamp('captured_at', { withTimezone: true }),
//     createdAt: timestamp('created_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//     updatedAt: timestamp('updated_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//   },
//   (table) => [
//     index('idx_payment_sessions_status').on(table.status),
//     index('idx_payment_sessions_user_id').on(table.userId),
//     index('idx_payment_sessions_expires_at').on(table.expiresAt),
//     // 성능 최적화: 사용자별 세션 조회용 복합 인덱스
//     index('idx_payment_sessions_user_created').on(
//       table.userId,
//       table.createdAt,
//     ),
//     // 환불 처리 시 세션 조회용 복합 인덱스
//     index('idx_payment_sessions_status_updated').on(
//       table.status,
//       table.updatedAt,
//     ),
//   ],
// );

// export const paymentLocks = pgTable(
//   'payment_locks',
//   {
//     id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
//     paymentSessionId: varchar('payment_session_id', { length: 26 })
//       .notNull()
//       .references(() => paymentSessionss.id, { onDelete: 'cascade' }),
//     lockToken: varchar('lock_token', { length: 128 }).notNull().unique(),
//     deviceFingerprint: varchar('device_fingerprint', { length: 64 }),
//     userAgent: text('user_agent'),
//     ipAddress: varchar('ip_address', { length: 45 }),
//     status: varchar('status', { length: 20 })
//       .$type<PaymentLockStatus>()
//       .notNull()
//       .default('ACTIVE'),
//     expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
//     createdAt: timestamp('created_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//   },
//   (table) => [
//     uniqueIndex('idx_active_payment_lock')
//       .on(table.paymentSessionId)
//       .where(sql`${table.status} = 'ACTIVE'`),
//     index('idx_payment_locks_expires_at').on(table.expiresAt),
//     index('idx_payment_locks_status').on(table.status),
//     uniqueIndex('idx_payment_locks_token_unique').on(table.lockToken),
//   ],
// );

// export const paymentSessionEvents = pgTable(
//   'payment_session_events',
//   {
//     id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
//     paymentSessionId: varchar('payment_session_id', { length: 26 })
//       .notNull()
//       .references(() => paymentSessionss.id, { onDelete: 'cascade' }),
//     eventType: varchar('event_type', { length: 32 })
//       .$type<PaymentSessionEventType>()
//       .notNull(),
//     eventData: text('event_data'),
//     occurredAt: timestamp('occurred_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//   },
//   (table) => [
//     index('idx_payment_session_events_session_id').on(table.paymentSessionId),
//     index('idx_payment_session_events_occurred_at').on(table.occurredAt),
//     index('idx_payment_session_events_event_type').on(table.eventType),
//   ],
// );

// ────────────────────────────────────────────
/** Payment Event Schemas (PaymentAttempt 의미) */
// ─────────────────────────────
// export const paymentEvents = pgTable(
//   'payment_events',
//   {
//     id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),
//     sessionId: varchar('session_id', { length: 26 })
//       .notNull()
//       .references(() => paymentSessionss.id), // 모든 결제는 세션 필수
//     profileId: varchar('profile_id', { length: 26 }).references(
//       () => paymentProfiles.id,
//     ), // nullable로 변경 (ephemeral 지원)
//     amount: numeric('amount', { precision: 19, scale: 4 })
//       .$type<number>()
//       .notNull(),
//     status: varchar('status', { length: 255 })
//       .$type<TransactionStatus>()
//       .notNull(),
//     actor: varchar('actor', { length: 255 })
//       .$type<'USER' | 'SCHEDULER' | 'ADMIN' | 'SYSTEM'>()
//       .notNull(),

//     // v4 아키텍처: Attempt 의미 보강
//     provider: varchar('provider', { length: 32 }).$type<PaymentProvider>(), // 'TOSS'|'KAKAOPAY'|'CMS'|'BNPL'|'POINTS'
//     instrumentKind: varchar('instrument_kind', {
//       length: 16,
//     }).$type<InstrumentKind>(), // 'stored'|'ephemeral'
//     instrumentRef: text('instrument_ref'), // ephemeral 승인키 등

//     createdAt: timestamp('created_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//     updatedAt: timestamp('updated_at', { withTimezone: true })
//       .defaultNow()
//       .notNull(),
//     errorMessage: text('error_message'),
//     // 🎯 문서 가이드라인: event_context로 통합 (pgResponse, metadata, pricingSnapshot 대체)
//     eventContext: text('event_context')
//       .$type<{
//         pg?: {
//           gateway: string;
//           approvalNumber?: string;
//           paymentDate?: string;
//           actualAmount?: number;
//           fee?: number;
//           transactionId?: string;
//         };
//         business?: {
//           paymentPurpose?: string;
//           isSubscriptionPayment?: boolean;
//           source?: string;
//           hmsMemberId?: string;
//           billingCycle?: string;
//           scheduledAt?: string;
//         };
//         pricing?: {
//           originalAmount?: number;
//           discountAmount?: number;
//           finalAmount?: number;
//           couponId?: string;
//           discountRate?: number;
//         };
//       }>()
//       .notNull(),
//     transactionId: varchar('transaction_id', { length: 255 }), // PG사 트랜잭션 ID
//     approvalNumber: varchar('approval_number', { length: 255 }), // 승인번호
//   },
//   (table) => [
//     index('idx_payment_events_profile_id').on(table.profileId),
//     index('idx_payment_events_status').on(table.status),
//     index('idx_payment_events_created_at').on(table.createdAt),
//     index('idx_payment_events_session_id').on(table.sessionId),
//     // 성능 최적화: 세션별 결제 이벤트 조회용 복합 인덱스
//     index('idx_payment_events_session_created').on(
//       table.sessionId,
//       table.createdAt,
//     ),
//   ],
// );

// ────────────────────────────────────────────
/** User Refund Account Schemas */
// ────────────────────────────────────────────

export const userRefundAccounts = pgTable(
  'user_refund_accounts',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),
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
/** Refund Event Schemas (PaymentRefund 의미) */
// ────────────────────────────────────────────

export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
  paymentAttemptId: varchar('payment_attempt_id', { length: 26 })
    .notNull()
    .references(() => paymentAttempts.id),
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
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateUUIDv7()),
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

export const pointEvents = pgTable('point_events', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => generateUUIDv7()),
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

// ────────────────────────────────────────────
/** Policy Tables - 정책 테이블화 (리뉴얼.md 6.1절) */
// ────────────────────────────────────────────

/**
 * 결제 타입별 허용 Provider 정책 테이블
 * - 런타임에 정책 변경 가능
 * - 어드민 UI에서 ON/OFF 제어
 */

/**
 * 타입별 비즈니스 파라미터 테이블 (선택적)
 */

export const overdueAccounts = pgTable('overdue_accounts', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),
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

// Payment method relations - 정규화된 구조
export const paymentProfilesRelations = relations(
  paymentProfiles,
  ({ one }) => ({
    card: one(cmsCardProfiles, {
      fields: [paymentProfiles.id],
      references: [cmsCardProfiles.id],
    }),
    batch: one(cmsBatchProfiles, {
      fields: [paymentProfiles.id],
      references: [cmsBatchProfiles.id],
    }),
  }),
);

export const cmsCardProfilesRelations = relations(
  cmsCardProfiles,
  ({ one }) => ({
    paymentProfile: one(paymentProfiles, {
      fields: [cmsCardProfiles.id],
      references: [paymentProfiles.id],
    }),
  }),
);

export const cmsBatchProfilesRelations = relations(
  cmsBatchProfiles,
  ({ one }) => ({
    paymentProfile: one(paymentProfiles, {
      fields: [cmsBatchProfiles.id],
      references: [paymentProfiles.id],
    }),
  }),
);

// BNPL relations
export const bnplAccountsRelations = relations(bnplAccounts, ({ many }) => ({
  activationEvents: many(bnplActivationEvents),
  transactions: many(bnplEvents),
  bnplInvoices: many(bnplInvoices),
}));

export const bnplActivationEventRelations = relations(
  bnplActivationEvents,
  ({ one }) => ({
    paymentProfile: one(paymentProfiles, {
      fields: [bnplActivationEvents.paymentProfileId],
      references: [paymentProfiles.id],
    }),
    bnplAccount: one(bnplAccounts, {
      fields: [bnplActivationEvents.bnplAccountId],
      references: [bnplAccounts.id],
    }),
  }),
);

export const bnplEventsRelations = relations(bnplEvents, ({ one, many }) => ({
  bnplAccount: one(bnplAccounts, {
    fields: [bnplEvents.bnplAccountId],
    references: [bnplAccounts.id],
  }),
  // paymentSession 관계는 순환 참조 문제로 인해 제거
  // 필요시 서비스 레이어에서 별도 조회
  bnplInvoiceItems: many(bnplInvoiceItems),
}));

export const bnplInvoicesRelations = relations(
  bnplInvoices,
  ({ one, many }) => ({
    bnplAccount: one(bnplAccounts, {
      fields: [bnplInvoices.bnplAccountId],
      references: [bnplAccounts.id],
    }),
    items: many(bnplInvoiceItems),
  }),
);

export const bnplInvoiceItemsRelations = relations(
  bnplInvoiceItems,
  ({ one }) => ({
    bnplInvoice: one(bnplInvoices, {
      fields: [bnplInvoiceItems.invoiceId],
      references: [bnplInvoices.id],
    }),
    bnplEvent: one(bnplEvents, {
      fields: [bnplInvoiceItems.bnplEventId],
      references: [bnplEvents.id],
    }),
  }),
);

export const bnplCollectionEventsRelations = relations(
  bnplCollectionEvents,
  ({ one }) => ({
    bnplInvoice: one(bnplInvoices, {
      fields: [bnplCollectionEvents.invoiceId],
      references: [bnplInvoices.id],
    }),
    bnplInvoiceItem: one(bnplInvoiceItems, {
      fields: [bnplCollectionEvents.invoiceItemId],
      references: [bnplInvoiceItems.id],
    }),
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
  paymentAttempt: one(paymentAttempts, {
    fields: [refundEvents.paymentAttemptId],
    references: [paymentAttempts.id],
  }),
  userRefundAccount: one(userRefundAccounts, {
    fields: [refundEvents.refundAccountId],
    references: [userRefundAccounts.id],
  }),
}));

// Point Relations
export const pointsRelations = relations(points, ({ many }) => ({
  transactions: many(pointEvents),
}));

export const pointEventsRelations = relations(pointEvents, ({ one }) => ({
  pointAccount: one(points, {
    fields: [pointEvents.pointId],
    references: [points.id],
  }),
}));

// ────────────────────────────────────────────
/** BNPL Enrollment - 단일 리소스 등록 플로우 */
// ────────────────────────────────────────────

/**
 * BNPL 등록 단일 리소스 - 전체 플로우를 하나의 엔드포인트로 관리
 */

// Policy Tables Relations

// ────────────────────────────────────────────
/** v2 Architecture Tables - 새로운 테이블 구조 (옵션 B: 리네임) */
// ────────────────────────────────────────────

/**
 * PaymentIntent 테이블 - 결제 의도 (provider 없음, 실행 시점에서 결정)
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: varchar('id', { length: 30 }).primaryKey(), // pi_xxxxx
    customerId: varchar('customer_id', { length: 64 }).notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    status: varchar('status', { length: 24 })
      .$type<PaymentSessionStatus>()
      .notNull()
      .default('PENDING'),
    type: varchar('type', { length: 32 })
      .$type<PaymentIntentType>()
      .notNull()
      .default('ORDER'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: text('metadata'), // JSON - 외부 도메인 맥락 저장만
    refundedAmount: numeric('refunded_amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull()
      .default(0),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 성능 최적화 인덱스
    index('idx_payment_intents_customer_id').on(table.customerId),
    index('idx_payment_intents_status').on(table.status),
    index('idx_payment_intents_type').on(table.type),
    index('idx_payment_intents_created_at').on(table.createdAt),
    index('idx_payment_intents_expires_at').on(table.expiresAt),
    index('idx_payment_intents_customer_status').on(
      table.customerId,
      table.status,
    ),
    index('idx_payment_intents_type_status').on(table.type, table.status),
  ],
);

/**
 * PaymentAttempt 테이블 - 결제 시도 (여기에만 provider 존재)
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: varchar('id', { length: 30 }).primaryKey(), // pa_xxxxx
    intentId: varchar('intent_id', { length: 30 })
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),

    // 수단 선택 (둘 중 하나만)
    profileId: varchar('profile_id', { length: 26 }), // 저장형 프로필
    instrumentRef: text('instrument_ref'), // 웹 승인키 등(ephemeral)

    // 실행된 프로바이더 (서버가 프로필/승인키로 해석)
    provider: varchar('provider', { length: 32 })
      .$type<PaymentProvider>()
      .notNull(),

    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    status: varchar('status', { length: 24 })
      .$type<TransactionStatus>()
      .notNull(),
    actor: varchar('actor', { length: 16 })
      .$type<'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN'>()
      .notNull()
      .default('USER'),

    // 요약 컨텍스트만 (raw 응답 금지)
    eventContext: text('event_context'), // { pg:{gateway,approvalNumber?...}, business:{type,source} }

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorMessage: text('error_message'),
    transactionId: varchar('transaction_id', { length: 255 }), // PG사 트랜잭션 ID
    approvalNumber: varchar('approval_number', { length: 255 }), // 승인번호
  },
  (table) => [
    // 성능 최적화 인덱스
    index('idx_payment_attempts_intent_created').on(
      table.intentId,
      table.createdAt,
    ),
    index('idx_payment_attempts_status').on(table.status),
    index('idx_payment_attempts_provider').on(table.provider),
    index('idx_payment_attempts_profile_id').on(table.profileId),
    index('idx_payment_attempts_provider_status').on(
      table.provider,
      table.status,
    ),
  ],
);

/**
 * PaymentRefund 테이블 - 환불
 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: varchar('id', { length: 30 }).primaryKey(), // rf_xxxxx
    intentId: varchar('intent_id', { length: 30 })
      .notNull()
      .references(() => paymentIntents.id),
    attemptId: varchar('attempt_id', { length: 30 })
      .notNull()
      .references(() => paymentAttempts.id),
    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    status: varchar('status', { length: 255 }).$type<RefundStatus>().notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: varchar('completed_by', { length: 64 }),
    metadata: text('metadata'),
    refundAccountId: varchar('refund_account_id', { length: 26 }).references(
      () => userRefundAccounts.id,
    ),
  },
  (table) => [
    // 성능 최적화 인덱스
    index('idx_payment_refunds_intent_id').on(table.intentId),
    index('idx_payment_refunds_attempt_id').on(table.attemptId),
    index('idx_payment_refunds_status').on(table.status),
    index('idx_payment_refunds_created_at').on(table.createdAt),
  ],
);

/**
 * CheckoutSession 테이블 - 웹 리다이렉트 UX용 경량 컨테이너 (provider 없음)
 */
export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: varchar('id', { length: 30 }).primaryKey(), // cs_xxxxx
    intentId: varchar('intent_id', { length: 30 })
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    redirectUrl: text('redirect_url').notNull(), // 우리 호스트 결제 UI or 지갑 허브
    returnUrl: text('return_url').notNull(), // 복귀 URL
    cancelUrl: text('cancel_url').notNull(),
    status: varchar('status', { length: 24 })
      .$type<'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'>()
      .notNull()
      .default('PENDING'),
    // 세션이 생성된 컨텍스트(디바이스/언어 등) 정도만 메타로 보관
    metadata: text('metadata'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 성능 최적화 인덱스
    index('idx_checkout_sessions_intent_id').on(table.intentId),
    index('idx_checkout_sessions_status').on(table.status),
    index('idx_checkout_sessions_created_at').on(table.createdAt),
    index('idx_checkout_sessions_expires_at').on(table.expiresAt),
  ],
);

// BNPL View들 제거됨 - 물리테이블만 사용
// settlement_batch = BNPL Invoice
// settlement_batch_item = BNPL Invoice Item
// settlement_process_event = BNPL Collection Event
