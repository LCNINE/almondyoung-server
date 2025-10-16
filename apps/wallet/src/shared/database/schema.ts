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
  pgEnum,
  jsonb,
  serial,
  date, // Supabase에서 사용하는 serial 추가
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
export type PaymentIntentType =
  (typeof paymentIntentTypeEnum.enumValues)[number];
export type PaymentProvider = (typeof paymentProviderEnum.enumValues)[number];
export type PaymentSessionStatus =
  (typeof paymentSessionStatusEnum.enumValues)[number];
export type PaymentProfileStatus =
  (typeof paymentProfileStatusEnum.enumValues)[number];
export type PaymentPurpose = (typeof paymentPurposeEnum.enumValues)[number];
export type BnplAccountStatus =
  (typeof bnplAccountStatusEnum.enumValues)[number];
export type RefundStatus = (typeof refundStatusEnum.enumValues)[number];
export type PointTransactionType =
  (typeof pointTransactionTypeEnum.enumValues)[number];
// ───────────────────────────────────────────
// Status Constants - Centralized Status Management (MVP Simplified)
// ────────────────────────────────────────────

// PaymentIntentType
export const paymentIntentTypeEnum = pgEnum('payment_intent_type', [
  'ORDER',
  'BNPL_CAPTURE',
  'MEMBERSHIP_FEE',
]);

// PaymentProvider (CMS 고정 제거)
export const paymentProviderEnum = pgEnum('payment_provider', [
  'TOSS',
  'KAKAOPAY',
  'HMS_CARD',
  'HMS_BNPL',
  'POINTS',
]);

// PaymentSessionStatus
export const paymentSessionStatusEnum = pgEnum('payment_session_status', [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'UNKNOWN',
]);

// TransactionStatus
export const transactionStatusEnum = pgEnum('transaction_status', [
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
]);

// PaymentProfileStatus
export const paymentProfileStatusEnum = pgEnum('payment_profile_status', [
  'PENDING',
  'ACTIVE',
  'INACTIVE',
]);

// PaymentPurpose
export const paymentPurposeEnum = pgEnum('payment_purpose', [
  'SUBSCRIPTION',
  'PURCHASE',
  'BOTH',
]);

// BNPLAccountStatus

// RefundStatus
export const refundStatusEnum = pgEnum('refund_status', [
  'REQUESTED',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
]);

// Supabase 실제 enum: "Point Action"
export const pointActionEnum = pgEnum('point_action', [
  'EARN',
  'EARN_CANCEL',
  'REDEEM',
  'REDEEM_CANCEL',
]);

// 레거시 호환성용 (기존 코드에서 사용)
export const pointTransactionTypeEnum = pointActionEnum;

export const TaxInvoiceStatus = {
  PENDING: 'PENDING',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
} as const;

export const TaxInvoiceKind = {
  NORMAL: 'NORMAL',
  MODIFICATION: 'MODIFICATION',
} as const;

export const ModificationType = {
  INCREASE: 'INCREASE',
  DECREASE: 'DECREASE',
  CANCEL: 'CANCEL',
} as const;

export const AggregationType = {
  SINGLE: 'SINGLE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;

export const TaxInvoiceEventType = {
  CREATED: 'CREATED',
  VALIDATED: 'VALIDATED',
  EXPORTED: 'EXPORTED',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  ERROR: 'ERROR',
} as const;

export const CancelReason = {
  CHANGE_OF_MIND: 'CHANGE_OF_MIND',
  DEFECTIVE: 'DEFECTIVE',
  WRONG_DELIVERY: 'WRONG_DELIVERY',
  DUPLICATE: 'DUPLICATE',
  ADMIN_REQUEST: 'ADMIN_REQUEST',
} as const;

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  HOMETAX_ERROR: 'HOMETAX_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
} as const;

export const ReasonCode = {
  CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
  WRONG_AMOUNT: 'WRONG_AMOUNT',
  DUPLICATE: 'DUPLICATE',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;

export const ValidationFailedReason = {
  INVALID_BUSINESS_NUMBER: 'INVALID_BUSINESS_NUMBER',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  MISSING_REQUIRED: 'MISSING_REQUIRED',
  DATE_ERROR: 'DATE_ERROR',
} as const;

export const bnplAccountStatusEnum = pgEnum('bnpl_account_status', [
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
]);

export const bnplEventTypeEnum = pgEnum('bnpl_event_type', [
  // 거래 이벤트
  'PURCHASE', // 구매
  'REFUND', // 환불
  'PARTIAL_REFUND', // 부분 환불

  // 신용 한도 이벤트
  'CREDIT_INCREASE', // 한도 증가
  'CREDIT_DECREASE', // 한도 감소

  // 청구 이벤트
  'INVOICE_CREATED', // 청구서 생성
  'INVOICE_DUE', // 청구서 만기

  // 결제 이벤트
  'PAYMENT_SCHEDULED', // 결제 예약
  'PAYMENT_ATTEMPTED', // 결제 시도
  'PAYMENT_SUCCESS', // 결제 성공
  'PAYMENT_FAILED', // 결제 실패
  'PAYMENT_RETRY', // 결제 재시도

  // 연체 이벤트
  'LATE_FEE', // 연체료
  'OVERDUE_NOTICE', // 연체 통지
]);
export const bnplEventCategoryEnum = pgEnum('bnpl_event_category', [
  'CREDIT', // 한도 사용
  'DEBIT', // 한도 복원
  'NEUTRAL', // 신용변동 없음
]);

export const bnplEventStatusEnum = pgEnum('bnpl_event_status', [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'AGGREGATED',
]);

export const bnplReasonCodeEnum = pgEnum('bnpl_reason_code', [
  'CUSTOMER_REQUEST',
  'INSUFFICIENT_FUNDS',
  'CARD_DECLINED',
  'FRAUD_SUSPECTED',
  'SYSTEM_ERROR',
  'ADMIN_ACTION',
]);

export type BnplEventType = (typeof bnplEventTypeEnum.enumValues)[number];
export type BnplEventCategory =
  (typeof bnplEventCategoryEnum.enumValues)[number];
export type BnplEventStatus = (typeof bnplEventStatusEnum.enumValues)[number];
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

    kind: varchar('kind', { length: 16 })
      .$type<'CARD' | 'BANK_ACCOUNT' | 'WALLET'>()
      .notNull(),
    provider: varchar('provider', { length: 16 })
      .$type<'HMS_CARD' | 'HMS_BNPL' | 'TOSS' | 'POINTS'>()
      .notNull(),
    status: paymentProfileStatusEnum('status').notNull().default('PENDING'),

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
    index('idx_payment_profiles_kind').on(table.kind),
  ],
);

/** 효성 CMS — 신용카드(TE-0040) 최소 + UX 요약 */
export const cmsCardProfiles = pgTable(
  'cms_card_profiles',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .references(() => paymentProfiles.id, { onDelete: 'cascade' }),

    memberId: varchar('member_id', { length: 20 }).notNull().unique(),
    cmsStatus: varchar('cms_status', { length: 16 }).notNull(),

    paymentCompany: varchar('payment_company', { length: 3 }),
    cardLast4: varchar('card_last4', { length: 4 }),
    cardBrand: varchar('card_brand', { length: 32 }),
    payerName: varchar('payer_name', { length: 64 }),
    phoneMask: varchar('phone_mask', { length: 20 }),

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
export const cmsBatchProfiles = pgTable('cms_batch_profiles', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .references(() => paymentProfiles.id, { onDelete: 'cascade' }),

  memberId: varchar('member_id', { length: 20 }).notNull().unique(),
  cmsStatus: varchar('cms_status', { length: 16 }).notNull(),

  paymentCompany: varchar('payment_company', { length: 3 }),
  payerName: varchar('payer_name', { length: 64 }),
  phoneMask: varchar('phone_mask', { length: 20 }),
  billingDay: integer('billing_day'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cmsBatchConsents = pgTable(
  'consents',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
    userId: varchar('user_id', { length: 64 }).notNull(),
    cmsBatchProfileId: varchar('cms_batch_profile_id', { length: 36 })
      .notNull()
      .references(() => cmsBatchProfiles.id),
    agreementKey: varchar('agreement_key', { length: 36 }),
    agreementKind: varchar('agreement_kind', { length: 8 }),
    status: varchar('status', { length: 16 })
      .$type<'PENDING' | 'AWAITING' | 'REVIEW' | 'APPROVED' | 'REJECTED'>()
      .notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_consents_payment_profile').on(table.cmsBatchProfileId),
    index('idx_consents_status').on(table.status),
  ],
);

// ────────────────────────────────────────────
// BNPL Schemas
// ────────────────────────────────────────────

export const bnplAccounts = pgTable(
  'bnpl_accounts',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),

    userId: varchar('user_id', { length: 64 }).notNull(),

    // 한도
    creditLimit: bigint('credit_limit', { mode: 'number' }).notNull(),
    availableLimit: bigint('available_limit', { mode: 'number' }).notNull(),

    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    // ACTIVE | SUSPENDED | OVERDUE

    // 결제주기/정산정보
    billingCycleStart: date('billing_cycle_start'), // 이번 결제주기 시작일
    billingCycleEnd: date('billing_cycle_end'), // 이번 결제주기 종료일
    nextBillingDate: date('next_billing_date'), // 다음 CMS 출금 신청일
    lastBilledAt: timestamp('last_billed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_bnpl_user').on(t.userId),
    index('idx_bnpl_status').on(t.status),
    index('idx_bnpl_next_billing').on(t.nextBillingDate),
  ],
);

// ────────────────────────────────────────────
// 2️⃣ BNPL 이벤트 (모든 것을 이벤트로)
// ────────────────────────────────────────────

export const bnplEvents = pgTable(
  'bnpl_events',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),

    accountId: varchar('account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccounts.id, { onDelete: 'cascade' }),

    // 이벤트 타입/카테고리
    eventType: bnplEventTypeEnum('event_type').notNull(),
    eventCategory: bnplEventCategoryEnum('event_category').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),

    // 주문/결제 참조
    externalOrderId: varchar('external_order_id', { length: 64 }),
    paymentIntentId: varchar('payment_intent_id', { length: 36 }),

    // 청구주기·CMS 배치 정보
    aggregationPeriod: varchar('aggregation_period', { length: 16 }), // '2024-09'
    isAggregated: boolean('is_aggregated').notNull().default(false),
    batchTransactionId: varchar('batch_transaction_id', { length: 50 }), // CMS 거래ID
    batchDueDate: date('batch_due_date'), // CMS 출금 신청일

    // CMS 응답·상태
    cmsStatus: varchar('cms_status', { length: 32 }), // REQUESTED/PROCESSED/FAILED
    cmsErrorCode: varchar('cms_error_code', { length: 64 }),

    // 상태·사유
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    reasonCode: varchar('reason_code', { length: 32 }),
    reasonDetail: text('reason_detail'),
    errorMessage: text('error_message'),

    actor: varchar('actor', { length: 32 }).notNull().default('SYSTEM'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_be_account').on(t.accountId),
    index('idx_be_type').on(t.eventType),
    index('idx_be_category').on(t.eventCategory),
    index('idx_be_period').on(t.aggregationPeriod),
    index('idx_be_batch').on(t.batchTransactionId),
    index('idx_be_due_date').on(t.batchDueDate),
    index('idx_be_status').on(t.status),
  ],
);

// ────────────────────────────────────────────
// BNPL CMS Responses - CMS 응답 이력 추적
// ────────────────────────────────────────────

export const bnplCmsResponses = pgTable(
  'bnpl_cms_responses',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => getTsid().toString()),

    // 배치 단위 추적
    batchId: varchar('batch_id', { length: 50 }).notNull(),
    accountId: varchar('account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccounts.id, { onDelete: 'cascade' }),

    // 개별 이벤트 참조 (선택적 - 배치 전체 응답인 경우 null)
    eventId: varchar('event_id', { length: 26 }).references(
      () => bnplEvents.id,
      { onDelete: 'cascade' },
    ),

    // 응답 타입
    responseType: varchar('response_type', { length: 32 }).notNull(),
    // 'BATCH_REQUEST_SUBMITTED' - 배치 출금 신청
    // 'BATCH_RESULT_CONFIRMED' - 배치 결과 확인
    // 'BATCH_RETRY_ATTEMPTED' - 배치 재시도

    // HMS CMS 응답 원본
    cmsResponseSnapshot: jsonb('cms_response_snapshot').notNull(),

    // 상태 변화 추적
    previousStatus: varchar('previous_status', { length: 32 }),
    newStatus: varchar('new_status', { length: 32 }).notNull(),

    // 메타데이터
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_bnpl_cms_batch').on(t.batchId),
    index('idx_bnpl_cms_account').on(t.accountId),
    index('idx_bnpl_cms_event').on(t.eventId),
    index('idx_bnpl_cms_type').on(t.responseType),
    index('idx_bnpl_cms_created').on(t.createdAt),
  ],
);

// 3️⃣ BNPL 이벤트 상세 (복식부기)
// ────────────────────────────────────────────

export const bnplEventDetails = pgTable(
  'bnpl_event_details',
  {
    id: varchar('id', { length: 26 }).primaryKey().$defaultFn(generateUUIDv7),

    eventId: varchar('event_id', { length: 26 })
      .notNull()
      .references(() => bnplEvents.id, { onDelete: 'cascade' }),

    accountId: varchar('account_id', { length: 26 }).notNull(),
    eventType: bnplEventTypeEnum('event_type').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),

    // 복식부기 패턴
    purchaseEventDetailId: varchar('purchase_event_detail_id', {
      length: 26,
    }).references(() => bnplEventDetails.id),
    originalEventDetailId: varchar('original_event_detail_id', {
      length: 26,
    }).references(() => bnplEventDetails.id),

    // 잔액 스냅샷
    balanceBefore: bigint('balance_before', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    availableBefore: bigint('available_before', { mode: 'number' }).notNull(),
    availableAfter: bigint('available_after', { mode: 'number' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_bed_event').on(t.eventId),
    index('idx_bed_account').on(t.accountId),
    index('idx_bed_purchase').on(t.purchaseEventDetailId),
    index('idx_bed_original').on(t.originalEventDetailId),
  ],
);
//
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
    status: text('status').$type<'PENDING' | 'SUCCESS' | 'FAILED'>().notNull(),
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

// Supabase에는 point_accounts 없음 - point_events에서 직접 계산
// CTO 코드에 없으므로 제거함

/**
 * 2️⃣ 포인트 이벤트 (Supabase 실제 구조)
 * - partner_id 기반으로 직접 관리
 * - 자기 참조 패턴 (original_event_id = new_event_id)
 */
export const pointEvents = pgTable(
  'point_events',
  {
    id: serial('id').primaryKey(), // Supabase는 serial 사용
    partnerId: integer('partner_id').notNull(), // partner 테이블 참조
    eventType: pointActionEnum('event_type').notNull(), // "Point Action" enum
    amount: integer('amount').notNull(),

    // Supabase 실제 필드들
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    withdrawalAvailableAt: timestamp('withdrawal_available_at', {
      withTimezone: true,
    }),
    reason: text('reason'),
    memo: text('memo'),
    orderId: varchar('order_id', { length: 100 }),
    originalEventId: integer('original_event_id').references(
      () => pointEvents.id,
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_point_events_partner').on(table.partnerId),
    index('idx_point_events_type').on(table.eventType),
    index('idx_point_events_expires').on(table.expiresAt),
    index('idx_point_events_original').on(table.originalEventId),
  ],
);

/**
 * 3️⃣ 포인트 이벤트 상세 (Supabase 실제 구조)
 * - 복식부기 FIFO 추적의 핵심
 * - earned_event_detail_id와 original_event_detail_id로 추적
 */
export const pointEventDetails = pgTable(
  'point_event_details',
  {
    id: serial('id').primaryKey(), // Supabase는 serial 사용
    pointEventId: integer('point_event_id')
      .notNull()
      .references(() => pointEvents.id),
    partnerId: integer('partner_id').notNull(), // partner_id 중복 저장 (성능)
    eventType: pointActionEnum('event_type').notNull(), // event_type 중복 저장
    amount: integer('amount').notNull(),

    // Supabase 복식부기 핵심 필드들
    earnedEventDetailId: integer('earned_event_detail_id').references(
      () => pointEventDetails.id,
    ),
    originalEventDetailId: integer('original_event_detail_id').references(
      () => pointEventDetails.id,
    ),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_point_event_details_event').on(table.pointEventId),
    index('idx_point_event_details_partner').on(table.partnerId),
    index('idx_point_event_details_earned').on(table.earnedEventDetailId),
    index('idx_point_event_details_original').on(table.originalEventDetailId),
  ],
);

/**
 * 4️⃣ Partners 테이블 (Supabase 실제 구조)
 * - 포인트 소유자 정보
 */
export const partners = pgTable(
  'partners',
  {
    id: serial('id').primaryKey(),
    mallId: varchar('mall_id', { length: 36 }).notNull(),
    memberId: varchar('member_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    referralCode: varchar('referral_code', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_partners_mall').on(table.mallId),
    index('idx_partners_member').on(table.memberId),
    uniqueIndex('idx_partners_referral_code').on(table.referralCode),
  ],
);

/**
 * 5️⃣ Referrals 테이블 (Supabase 실제 구조)
 * - 추천 관계 저장
 */
export const referrals = pgTable(
  'referrals',
  {
    mallId: varchar('mall_id', { length: 36 }).notNull(),
    memberId: varchar('member_id', { length: 36 }).notNull(),
    partnerId: integer('partner_id')
      .notNull()
      .references(() => partners.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_referrals_member').on(table.memberId),
    index('idx_referrals_partner').on(table.partnerId),
    index('idx_referrals_mall').on(table.mallId),
  ],
);

/**
 * 6️⃣ Referral Rewards 테이블 (Supabase 실제 구조)
 * - 추천인 보상 중복 체크용 (단순함)
 */
export const referralRewards = pgTable(
  'referral_rewards',
  {
    mallId: varchar('mall_id', { length: 36 }).notNull(),
    memberId: varchar('member_id', { length: 36 }).notNull(),
    requestId: integer('request_id').notNull(), // trigger_reward_process에서 받은 ID
    rewardedAt: timestamp('rewarded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_referral_rewards_member').on(table.memberId),
    index('idx_referral_rewards_mall').on(table.mallId),
    // 중복 방지용 unique 인덱스
    uniqueIndex('idx_referral_rewards_unique').on(table.mallId, table.memberId),
  ],
);

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

// );

export const bnplAccountsRelations = relations(bnplAccounts, ({ many }) => ({
  events: many(bnplEvents),
  bnplevents: many(bnplEvents),
  cmsResponses: many(bnplCmsResponses),
}));

export const bnplEventsRelations = relations(bnplEvents, ({ one, many }) => ({
  account: one(bnplAccounts, {
    fields: [bnplEvents.accountId],
    references: [bnplAccounts.id],
  }),
  details: many(bnplEventDetails),
  cmsResponses: many(bnplCmsResponses),
}));

export const bnplCmsResponsesRelations = relations(
  bnplCmsResponses,
  ({ one }) => ({
    account: one(bnplAccounts, {
      fields: [bnplCmsResponses.accountId],
      references: [bnplAccounts.id],
    }),
    event: one(bnplEvents, {
      fields: [bnplCmsResponses.eventId],
      references: [bnplEvents.id],
    }),
  }),
);

// ③ 디테일 → 이벤트 / 디테일 자기참조
export const bnplEventDetailsRelations = relations(
  bnplEventDetails,
  ({ one }) => ({
    event: one(bnplEvents, {
      fields: [bnplEventDetails.eventId],
      references: [bnplEvents.id],
    }),
    // 이 디테일이 어떤 구매 디테일에서 파생되었는가 (부분환불 등)
    purchaseDetail: one(bnplEventDetails, {
      fields: [bnplEventDetails.purchaseEventDetailId],
      references: [bnplEventDetails.id],
    }),
    // 이 디테일이 어떤 원본 디테일의 정정/취소인가
    originalDetail: one(bnplEventDetails, {
      fields: [bnplEventDetails.originalEventDetailId],
      references: [bnplEventDetails.id],
    }),
  }),
);

// User refund account relations
export const userRefundAccountsRelations = relations(
  userRefundAccounts,
  ({ many }) => ({
    refundEvents: many(paymentRefunds),
  }),
);

// Point Relations (Supabase 기반 - pointAccounts 없음)
export const pointEventsRelations = relations(pointEvents, ({ one, many }) => ({
  partner: one(partners, {
    fields: [pointEvents.partnerId],
    references: [partners.id],
  }),
  details: many(pointEventDetails),
  originalEvent: one(pointEvents, {
    fields: [pointEvents.originalEventId],
    references: [pointEvents.id],
  }),
}));

export const pointEventDetailsRelations = relations(
  pointEventDetails,
  ({ one }) => ({
    // detail → event (OK)
    event: one(pointEvents, {
      fields: [pointEventDetails.pointEventId],
      references: [pointEvents.id],
      relationName: 'event_details_to_event',
    }),

    // detail → earned detail (self reference)
    earnedFrom: one(pointEventDetails, {
      fields: [pointEventDetails.earnedEventDetailId],
      references: [pointEventDetails.id],
      relationName: 'detail_to_earned_detail',
    }),

    // detail → original detail (self reference)  **여기가 문제였음**
    originalOf: one(pointEventDetails, {
      fields: [pointEventDetails.originalEventDetailId],
      references: [pointEventDetails.id],
      relationName: 'detail_to_original_detail',
    }),
  }),
);

// 세금계산서 상태 (내부 운영 상태)
export const taxInvoiceStatusEnum = pgEnum('tax_invoice_status', [
  // 생성~발행 전 단계
  'PENDING', // 발행 예정(데이터 적립)
  'READY', // 검증 완료, 배치 대상 확정
  'EXPORTED', // 엑셀 파일 생성/배치 묶임
  // 발행 결과
  'ISSUED', // 홈택스 발행 성공
  'ERROR', // 검증/발행 오류
  // 무효/취소
  'CANCELLED', // 내부 취소(발행 전)
]);

// 세금계산서 종류
export const taxInvoiceKindEnum = pgEnum('tax_invoice_kind', [
  'NORMAL', // 일반 세금계산서
  'MODIFICATION', // 수정세금계산서
]);

// 수정세금계산서 유형 (국세청 분류 단순화)
export const modificationTypeEnum = pgEnum('modification_type', [
  'INCREASE', // 금액 증가
  'DECREASE', // 금액 감소(환불/부분취소)
  'CANCEL', // 전체 취소/무효
]);

// 과세유형 (필요 시 확장: 면세/영세율 등)
export const taxTypeEnum = pgEnum('tax_type', [
  'GENERAL', // 일반과세(10%)
  'ZERO', // 영세율(0%)
  'EXEMPT', // 면세
]);

// 출처(집계 단위) — 선택
export const invoiceSourceEnum = pgEnum('tax_invoice_source', [
  'ORDER', // 주문 단위
  'SETTLEMENT', // 월말/정산 단위(총액)
]);

// ────────────────────────────────────────────
// ────────────────────────────────────────────
// 1️⃣ 마스터 테이블 (초경량 - 10개 필드)
// ────────────────────────────────────────────

export const taxInvoices = pgTable(
  'tax_invoices',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),

    // 핵심 식별자
    userId: varchar('user_id', { length: 64 }).notNull(),
    externalOrderId: varchar('external_order_id', { length: 128 }),
    // 'ord_12345' (단일 주문)
    // 'agg_user123_2024-01' (합산)
    // 'manual_20240115_001' (수동)

    // 핵심 정보만
    supplyDate: date('supply_date').notNull(),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),

    // 상태
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    // PENDING | ISSUED | CANCELLED

    // 홈택스 결과
    hometaxApprovalNumber: varchar('hometax_approval_number', { length: 64 }),

    // 취소/에러 (명시적)
    cancelReason: varchar('cancel_reason', { length: 32 }),
    // CHANGE_OF_MIND | DEFECTIVE | WRONG_DELIVERY | DUPLICATE | ADMIN_REQUEST
    errorCode: varchar('error_code', { length: 32 }),
    // VALIDATION_FAILED | HOMETAX_ERROR | NETWORK_ERROR | DUPLICATE_REQUEST

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_ti_user_date').on(t.userId, t.supplyDate),
    index('idx_ti_status').on(t.status),
    index('idx_ti_order').on(t.externalOrderId),
    uniqueIndex('uq_ti_order').on(t.externalOrderId),
  ],
);

// ────────────────────────────────────────────
// 2️⃣ 이벤트 테이블 (명시적 필드, no metadata)
// ────────────────────────────────────────────

export const taxInvoiceEvents = pgTable(
  'tax_invoice_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => {
        return generateUUIDv7();
      }),

    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => taxInvoices.id, { onDelete: 'cascade' }),

    // 이벤트 타입
    eventType: varchar('event_type', { length: 32 }).notNull(),
    // CREATED | VALIDATED | EXPORTED | ISSUED | CANCELLED | REFUNDED | ERROR

    // 상태 변경 추적
    previousStatus: varchar('previous_status', { length: 16 }),
    newStatus: varchar('new_status', { length: 16 }),

    // 금액 변경 추적 (수정세금계산서)
    previousAmount: bigint('previous_amount', { mode: 'number' }),
    newAmount: bigint('new_amount', { mode: 'number' }),

    // 사유 (명시적)
    reasonCode: varchar('reason_code', { length: 32 }),
    // CUSTOMER_REQUEST | WRONG_AMOUNT | DUPLICATE | SYSTEM_ERROR | ADMIN_ACTION
    reasonDetail: text('reason_detail'),

    // 배치 정보
    batchId: varchar('batch_id', { length: 36 }),

    // 실행자
    actor: varchar('actor', { length: 64 }).notNull().default('SYSTEM'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_tie_invoice').on(t.invoiceId),
    index('idx_tie_type').on(t.eventType),
    index('idx_tie_created').on(t.createdAt),
    index('idx_tie_batch').on(t.batchId),
  ],
);

// ────────────────────────────────────────────
// 3️⃣ 상세 테이블 (무거운 데이터 격리)
// ────────────────────────────────────────────

export const taxInvoiceEventsDetails = pgTable(
  'tax_invoice_events_details',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => {
        return generateUUIDv7();
      }),

    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => taxInvoices.id, { onDelete: 'cascade' })
      .unique(), // 1:1 관계

    // 결제 참조
    paymentIntentId: varchar('payment_intent_id', { length: 36 }).references(
      () => paymentIntents.id,
      { onDelete: 'set null' },
    ),
    paymentAttemptId: varchar('payment_attempt_id', { length: 36 }),

    // 세금계산서 종류
    kind: varchar('kind', { length: 16 }).notNull().default('NORMAL'),
    // NORMAL | MODIFICATION
    modificationType: varchar('modification_type', { length: 16 }),
    // INCREASE | DECREASE | CANCEL
    originalInvoiceId: varchar('original_invoice_id', {
      length: 36,
    }).references(() => taxInvoices.id, { onDelete: 'restrict' }),

    // 합산 발행 정보
    aggregationType: varchar('aggregation_type', { length: 16 }),
    // SINGLE | DAILY | WEEKLY | MONTHLY
    aggregationKey: varchar('aggregation_key', { length: 128 }),
    // 'user123_2024-01' (월 합산)
    // 'user123_2024-W03' (주 합산)

    // 고객 정보
    customerName: varchar('customer_name', { length: 128 }).notNull(),
    customerBusinessNumber: varchar('customer_business_number', { length: 20 }),

    // 날짜 상세
    issueDate: date('issue_date').notNull(),

    // 금액 상세
    supplyAmount: bigint('supply_amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull(),

    // 환불 추적
    refundedAmount: bigint('refunded_amount', { mode: 'number' })
      .notNull()
      .default(0),
    netAmount: bigint('net_amount', { mode: 'number' }).notNull(),

    // 배치 처리
    batchId: varchar('batch_id', { length: 36 }),
    batchExportedAt: timestamp('batch_exported_at', { withTimezone: true }),
    batchSequence: integer('batch_sequence'),
    batchPeriod: varchar('batch_period', { length: 10 }), // '2024-01'
    exportedFilePath: text('exported_file_path'),

    // 검증
    isValidated: boolean('is_validated').notNull().default(false),
    validationFailedReason: varchar('validation_failed_reason', { length: 64 }),
    // INVALID_BUSINESS_NUMBER | AMOUNT_MISMATCH | MISSING_REQUIRED | DATE_ERROR

    // 홈택스 발행 시각
    hometaxIssuedAt: timestamp('hometax_issued_at', { withTimezone: true }),

    // 오류 상세
    errorMessage: text('error_message'),

    // 불변 스냅샷 (구조화된 불변 데이터)
    invoiceSnapshot: jsonb('invoice_snapshot')
      .$type<{
        supplier: {
          businessNumber: string;
          name: string;
          ceoName: string;
          address: string;
          email?: string;
          businessType?: string;
          businessCategory?: string;
        };
        customer: {
          businessNumber?: string;
          name: string;
          ceoName?: string;
          address?: string;
          email?: string;
        };
        items: Array<{
          name: string;
          spec?: string;
          quantity?: number;
          unitPrice?: number;
          supplyAmount: number;
          taxAmount: number;
        }>;
        orderMeta?: {
          orderDate?: string;
          deliveryDate?: string;
          shippingAddress?: string;
        };
        aggregatedOrderIds?: string[]; // 합산시 원본 주문들
      }>()
      .notNull(),

    // 감사
    createdBy: varchar('created_by', { length: 64 })
      .notNull()
      .default('SYSTEM'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('idx_tid_invoice').on(t.invoiceId),
    index('idx_tid_payment').on(t.paymentIntentId),
    index('idx_tid_batch').on(t.batchId),
    index('idx_tid_original').on(t.originalInvoiceId),
    index('idx_tid_period').on(t.batchPeriod),
    index('idx_tid_aggregation').on(t.aggregationType, t.aggregationKey),
  ],
);

// 원천 이벤트 로그
export const cashReceiptEvents = pgTable(
  'cash_receipt_events',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
    userId: varchar('user_id').notNull(), // 발급 주체
    cashReceiptId: text('cash_receipt_id').notNull(), // 외부 ID (YYYYMMDD+연번)
    eventType: text('event_type').notNull(), // ISSUE, CANCEL
    requestPayload: jsonb('request_payload'), // 발급 요청 원본
    responsePayload: jsonb('response_payload'), // 응답 원본
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_cash_receipt_events_receipt').on(table.cashReceiptId)],
);

// 이벤트 상세 (금액, 승인번호 등)
export const cashReceiptEventDetails = pgTable(
  'cash_receipt_event_details',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
    eventId: varchar('event_id', { length: 36 })
      .notNull()
      .references(() => cashReceiptEvents.id),
    supplyAmount: integer('supply_amount'),
    vatAmount: integer('vat_amount'),
    serviceAmount: integer('service_amount'),
    totalAmount: integer('total_amount'),
    receiptApprovalNumber: text('receipt_approval_number'),
    receiptDate: date('receipt_date'),
    receiptPurpose: text('receipt_purpose'),
    cancelDate: date('cancel_date'),
    cancelApprovalNumber: text('cancel_approval_number'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_cash_receipt_event_details_event').on(table.eventId)],
);

// ───────────────────────────────────────────
// DiscountLine 타입 정의 (포인트 할인 정보)
// ───────────────────────────────────────────
export type DiscountLine = {
  type: 'POINTS';
  amount: number;
  pointEventId: number;
  appliedAt: Date;
};

/**
 * PaymentIntent 테이블 - 결제 의도 (provider 없음, 실행 시점에서 결정)
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    customerId: varchar('customer_id', { length: 64 }).notNull(),

    // 금액 필드 (포인트 통합 지원) - 모두 정수(원 단위)로 통일
    amount: bigint('amount', { mode: 'number' }).notNull(), // 레거시 호환용 (totalAmount와 동일)
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(), // 원래 금액
    discounts: jsonb('discounts')
      .default(sql`'[]'::jsonb`)
      .$type<DiscountLine[]>(), // 할인 내역
    discountsTotal: bigint('discounts_total', { mode: 'number' })
      .notNull()
      .default(0), // 할인 총액
    finalAmount: bigint('final_amount', { mode: 'number' }).notNull(), // 실제 결제액 (totalAmount - discountsTotal)

    status: paymentSessionStatusEnum('status').notNull().default('PENDING'),
    type: paymentIntentTypeEnum('type').notNull().default('ORDER'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata'),
    refundedAmount: bigint('refunded_amount', { mode: 'number' })
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
    index('idx_payment_intents_customer_id').on(table.customerId),
    index('idx_payment_intents_status').on(table.status),
    index('idx_payment_intents_type').on(table.type),
  ],
);

/**
 * PaymentAttempt 테이블 - 결제 시도 (여기에만 provider 존재)
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    intentId: varchar('intent_id', { length: 36 })
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    profileId: varchar('profile_id', { length: 36 }),
    // 프로필 기반 vs 일회성 구분
    instrumentType: varchar('instrument_type', { length: 16 })
      .$type<'PROFILE' | 'ONE_TIME'>()
      .notNull()
      .default('PROFILE'),
    provider: paymentProviderEnum('provider').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: transactionStatusEnum('status').notNull(),
    actor: text('actor')
      .$type<'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN'>()
      .notNull()
      .default('USER'),
    requestMetadata: jsonb('request_metadata'),
    providerResponseSnapshot: jsonb('provider_response_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    transactionId: varchar('transaction_id', { length: 255 }),
    approvalNumber: varchar('approval_number', { length: 255 }),
  },
  (table) => [
    index('idx_payment_attempts_intent_created').on(
      table.intentId,
      table.createdAt,
    ),
  ],
);
/**
 * PaymentRefund 테이블 - 환불
 */

export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
    intentId: varchar('intent_id', { length: 36 })
      .notNull()
      .references(() => paymentIntents.id),
    attemptId: varchar('attempt_id', { length: 36 })
      .notNull()
      .references(() => paymentAttempts.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: refundStatusEnum('status').notNull(),
    reason: text('reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: varchar('completed_by', { length: 64 }),
    metadata: jsonb('metadata'),
    refundAccountId: varchar('refund_account_id', { length: 36 }).references(
      () => userRefundAccounts.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_payment_refunds_intent_id').on(table.intentId),
    index('idx_payment_refunds_attempt_id').on(table.attemptId),
    index('idx_payment_refunds_status').on(table.status),
  ],
);

/**
 * CheckoutSession 테이블 - 웹 리다이렉트 UX용 경량 컨테이너 (provider 없음)
 */
export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(), // cs_xxxxx
    intentId: varchar('intent_id', { length: 36 })
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
    metadata: jsonb('metadata')
      .$type<{
        deviceInfo?: {
          userAgent?: string;
          platform?: string;
          language?: string;
        };
        source?: string;
        referrer?: string;
        [key: string]: any; // 추가 필드 허용
      }>()
      .default(sql`'{}'::jsonb`)
      .notNull(), // NOT NULL이지만 기본값이 있어서 문제없음
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

export const taxInvoicesRelations = relations(taxInvoices, ({ one, many }) => ({
  detail: one(taxInvoiceEventsDetails, {
    fields: [taxInvoices.id],
    references: [taxInvoiceEventsDetails.invoiceId],
  }),
  events: many(taxInvoiceEvents),
}));

export const taxInvoiceEventsDetailsRelations = relations(
  taxInvoiceEventsDetails,
  ({ one }) => ({
    invoice: one(taxInvoices, {
      fields: [taxInvoiceEventsDetails.invoiceId],
      references: [taxInvoices.id],
    }),
    originalInvoice: one(taxInvoices, {
      fields: [taxInvoiceEventsDetails.originalInvoiceId],
      references: [taxInvoices.id],
    }),
    paymentIntent: one(paymentIntents, {
      fields: [taxInvoiceEventsDetails.paymentIntentId],
      references: [paymentIntents.id],
    }),
  }),
);

export const taxInvoiceEventsRelations = relations(
  taxInvoiceEvents,
  ({ one }) => ({
    invoice: one(taxInvoices, {
      fields: [taxInvoiceEvents.invoiceId],
      references: [taxInvoices.id],
    }),
  }),
);

export const cashReceiptEventsRelations = relations(
  cashReceiptEvents,
  ({ one }) => ({
    eventDetails: one(cashReceiptEventDetails, {
      fields: [cashReceiptEvents.id],
      references: [cashReceiptEventDetails.eventId],
    }),
  }),
);

// BNPL View들 제거됨 - 물리테이블만 사용
// settlement_batch = BNPL Invoice
// settlement_batch_item = BNPL Invoice Item
// settlement_process_event = BNPL Collection Event

// ===============================
// 전체 스키마 객체 Export (Drizzle ORM 규칙)
// ===============================
// 주의: DbService의 타입 체크를 위해 walletSchema만 사용하세요
// import * as schema를 사용하면 newMemberId 같은 함수도 포함되어 타입 에러 발생
export const walletSchema = {
  // v2 Architecture Tables
  paymentIntents,
  paymentAttempts,
  paymentRefunds,
  checkoutSessions,

  // Payment Profiles
  paymentProfiles,
  cmsCardProfiles,
  cmsBatchProfiles,

  // BNPL System
  bnplAccounts,
  bnplEvents,
  bnplCmsResponses,

  // Refund System
  userRefundAccounts,

  // Point System
  pointEvents,
  pointEventDetails,
  partners,
  referrals,
  referralRewards,

  // Utility Tables (Tax Invoice)
  taxInvoices,
  taxInvoiceEventsDetails,
  taxInvoiceEvents,

  idempotencyKeys,
} as const;

export type WalletSchema = typeof walletSchema;

// 하위 호환성을 위한 default export (기존 import * as schema 지원)
// 단, DbService 타입 파라미터로는 walletSchema만 사용하세요
export default walletSchema;
