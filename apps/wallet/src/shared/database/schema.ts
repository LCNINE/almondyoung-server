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
  date,
  check,
  bigserial, // Supabase에서 사용하는 serial 추가
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { authorizationSchema } from '@app/authorization';

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
export type PaymentIntentType = (typeof paymentIntentTypeEnum.enumValues)[number];
export type PaymentProvider = (typeof paymentProviderEnum.enumValues)[number];
export type PaymentIntentStatus = (typeof paymentIntentStatusEnum.enumValues)[number];
export type PaymentProfileStatus = (typeof paymentProfileStatusEnum.enumValues)[number];
export type PaymentPurpose = (typeof paymentPurposeEnum.enumValues)[number];
export type BnplAccountStatus = (typeof bnplAccountStatusEnum.enumValues)[number];
export type RefundStatus = (typeof refundStatusEnum.enumValues)[number];
export type PointTransactionType = (typeof pointTransactionTypeEnum.enumValues)[number];
// ───────────────────────────────────────────
// Status Constants - Centralized Status Management (MVP Simplified)
// ────────────────────────────────────────────

// PaymentIntentType
export const paymentIntentTypeEnum = pgEnum('payment_intent_type', ['ORDER', 'BNPL_CAPTURE', 'MEMBERSHIP_FEE']);

// PaymentProvider (CMS 고정 제거)
export const paymentProviderEnum = pgEnum('payment_provider', ['TOSS', 'KAKAOPAY', 'HMS_CARD', 'HMS_BNPL', 'POINTS']);

// PaymentSessionStatus
export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'UNKNOWN',
]);

// TransactionStatus
export const transactionStatusEnum = pgEnum('transaction_status', ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED']);

// PaymentProfileStatus
export const paymentProfileStatusEnum = pgEnum('payment_profile_status', ['PENDING', 'ACTIVE', 'INACTIVE']);

// PaymentPurpose
export const paymentPurposeEnum = pgEnum('payment_purpose', ['SUBSCRIPTION', 'PURCHASE', 'BOTH']);

// BNPLAccountStatus

// RefundStatus
export const refundStatusEnum = pgEnum('refund_status', ['REQUESTED', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED']);

// Supabase 실제 enum: "Point Action"
export const pointActionEnum = pgEnum('point_action', ['EARN', 'EARN_CANCEL', 'REDEEM', 'REDEEM_CANCEL']);

// 레거시 호환성용 (기존 코드에서 사용)
export const pointTransactionTypeEnum = pointActionEnum;

// Outbox Status (Transactional Outbox Pattern)
export const outboxStatusEnum = pgEnum('outbox_status', ['PENDING', 'PUBLISHED', 'FAILED']);

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

export const bnplAccountStatusEnum = pgEnum('bnpl_account_status', ['ACTIVE', 'SUSPENDED', 'CLOSED']);

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
export type BnplEventCategory = (typeof bnplEventCategoryEnum.enumValues)[number];
export type BnplEventStatus = (typeof bnplEventStatusEnum.enumValues)[number];
// ────────────────────────────────────────────
// Payment Method Schemas - 정규화된 구조 (민감값 저장 금지)
// ────────────────────────────────────────────
// 결제 수단 유형 (명시적 Enum으로 전환 추천)
export const paymentKindEnum = pgEnum('payment_kind', [
  'CARD', // 신용/체크카드
  'BANK_ACCOUNT', // 계좌 (BNPL 포함)
  'WALLET', // 간편결제/포인트
]);
/** 공통 결제 프로필(추상 슬롯) */
export const paymentProfiles = pgTable(
  'payment_profiles',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),

    userId: varchar('user_id', { length: 64 }).notNull(),

    // ✅ Enum 사용으로 타입 안정성 확보
    kind: paymentKindEnum('kind').notNull(),
    provider: paymentProviderEnum('provider').notNull(),

    status: paymentProfileStatusEnum('status').notNull().default('PENDING'),
    name: varchar('name', { length: 64 }), // 사용자 별칭 (예: "내 월급통장")
    paymentNumber: varchar('payment_number', { length: 25 }), // 계좌번호
    // ✅ 기본 결제 수단 여부
    isDefault: boolean('is_default').notNull().default(false),

    // ✅ Soft Delete (삭제 시각이 기록되면 삭제된 것으로 간주)
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 1. 조회 성능 최적화 (삭제 안 된 내역만 조회)
    index('idx_pp_user_active').on(table.userId, table.deletedAt),

    // 2. ✅ Partial Unique Index (핵심)
    // "삭제되지 않은(deleted_at IS NULL) 레코드 중, 유저별로 is_default=true는 단 하나만 존재해야 한다"
    uniqueIndex('uq_pp_user_default_active')
      .on(table.userId)
      .where(sql`${table.isDefault} = true AND ${table.deletedAt} IS NULL`),

    // 3. ✅ CHECK Constraints (데이터 무결성 보장)
    // 올바른 Kind와 Provider 조합만 허용
    check(
      'valid_provider_kind_mapping',
      sql`
        (
          (${table.kind} = 'CARD' AND ${table.provider} IN ('HMS_CARD', 'TOSS')) OR
          (${table.kind} = 'BANK_ACCOUNT' AND ${table.provider} IN ('HMS_BNPL', 'TOSS')) OR
          (${table.kind} = 'WALLET' AND ${table.provider} IN ('POINTS', 'KAKAOPAY'))
        )
      `,
    ),
  ],
);

/** 효성 CMS — 신용카드(TE-0040) 최소 + UX 요약 */
export const cmsCardProfiles = pgTable(
  'cms_card_profiles',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .references(() => paymentProfiles.id, { onDelete: 'cascade' }), // 부모 삭제 시 같이 삭제 (Soft Delete 시엔 로직으로 처리)

    memberId: varchar('member_id', { length: 20 }).notNull(), // 효성 회원번호
    cmsStatus: varchar('cms_status', { length: 16 }).notNull(), // 효성측 상태

    paymentCompany: varchar('payment_company', { length: 10 }), // 카드사 이름
    cardLast4: varchar('card_last4', { length: 4 }),
    cardBrand: varchar('card_brand', { length: 32 }),
    payerName: varchar('payer_name', { length: 64 }),
    phoneMask: varchar('phone_mask', { length: 20 }),

    // 자식 테이블은 별도의 deletedAt 없이 부모의 deletedAt을 따름 (Join 조회)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    // 효성 회원번호 유니크 (단, 삭제된 프로필은 제외하고 싶다면 Partial Index 고려)
    // 여기서는 재가입 등을 고려해 단순 인덱스로 두거나, 비즈니스 로직 체크 추천
    index('idx_cms_card_member').on(table.memberId),
  ],
);

/** 효성 배치 CMS(TE-0046) — 계좌/BNPL */
export const cmsBatchProfiles = pgTable('cms_batch_profiles', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .references(() => paymentProfiles.id, { onDelete: 'cascade' }),

  memberId: varchar('member_id', { length: 20 }).notNull(),
  cmsStatus: varchar('cms_status', { length: 16 }).notNull(),

  paymentCompany: varchar('payment_company', { length: 10 }), // 은행 코드
  payerName: varchar('payer_name', { length: 64 }),
  phoneMask: varchar('phone_mask', { length: 20 }),
  billingDay: varchar('billing_day', { length: 2 }), // 출금일

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    eventId: varchar('event_id', { length: 26 }).references(() => bnplEvents.id, { onDelete: 'cascade' }),

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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    partnerId: varchar('partner_id', { length: 36 }).notNull(), // UUIDv7 (customerId와 동일)
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
    originalEventId: integer('original_event_id').references(() => pointEvents.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    partnerId: varchar('partner_id', { length: 36 }).notNull(), // UUIDv7 (customerId와 동일)
    eventType: pointActionEnum('event_type').notNull(), // event_type 중복 저장
    amount: integer('amount').notNull(),

    // Supabase 복식부기 핵심 필드들
    earnedEventDetailId: integer('earned_event_detail_id').references(() => pointEventDetails.id),
    originalEventDetailId: integer('original_event_detail_id').references(() => pointEventDetails.id),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    rewardedAt: timestamp('rewarded_at', { withTimezone: true }).defaultNow().notNull(),
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
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).defaultNow().notNull(),
  status: varchar('status', { length: 20 }).$type<'ACTIVE' | 'SUSPENDED'>().notNull().default('ACTIVE'),
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

export const bnplCmsResponsesRelations = relations(bnplCmsResponses, ({ one }) => ({
  account: one(bnplAccounts, {
    fields: [bnplCmsResponses.accountId],
    references: [bnplAccounts.id],
  }),
  event: one(bnplEvents, {
    fields: [bnplCmsResponses.eventId],
    references: [bnplEvents.id],
  }),
}));

// ③ 디테일 → 이벤트 / 디테일 자기참조
export const bnplEventDetailsRelations = relations(bnplEventDetails, ({ one }) => ({
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
}));

// User refund account relations
export const userRefundAccountsRelations = relations(userRefundAccounts, ({ many }) => ({
  refundEvents: many(paymentRefunds),
}));

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

export const pointEventDetailsRelations = relations(pointEventDetails, ({ one }) => ({
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
}));

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

export const taxInvoices = pgTable(
  'tax_invoices',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),

    // 신청한 사용자
    userId: varchar('user_id', { length: 64 }).notNull(),

    // 주문 기준 발행 (scopeType / scopeId 제거)
    orderId: varchar('order_id', { length: 128 }).notNull(),

    // 상태 머신
    status: varchar('status', { length: 32 })
      .notNull()
      // REQUESTED | EXPORTED | ISSUED_CONFIRMED | FAILED | CANCELLED | NEEDS_MODIFICATION
      .default('REQUESTED'),

    // 공급시기 (세금계산서상 공급가액 기준 날짜)
    supplyDate: date('supply_date').notNull(),

    // 사업자 정보 스냅샷
    businessName: varchar('business_name', { length: 128 }).notNull(),
    businessNumber: varchar('business_number', { length: 20 }).notNull(),
    businessAddress: varchar('business_address', { length: 256 }).notNull(),
    businessOwnerName: varchar('business_owner_name', { length: 64 }).notNull(),

    // 금액 스냅샷
    supplyAmount: bigint('supply_amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull(),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),

    // 발행 작업 메타 (엑셀로 뽑은 시점 / 담당자)
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    exportedBy: varchar('exported_by', { length: 64 }),

    // 홈텍스 업로드 완료 시점(선택)
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),

    // 홈텍스 발행 결과
    hometaxIssueNo: varchar('hometax_issue_no', { length: 64 }),
    hometaxIssueDate: date('hometax_issue_date'),
    failReason: text('fail_reason'),

    // 취소/에러 코드 (옵션)
    cancelReason: varchar('cancel_reason', { length: 32 }),
    errorCode: varchar('error_code', { length: 32 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    // 자주 쓸 인덱스들
    index('idx_ti_user_date').on(t.userId, t.supplyDate),
    index('idx_ti_status').on(t.status),
    index('idx_ti_order').on(t.orderId),
    // 한 주문에 세금계산서 1장만 허용 (필요 없으면 제거)
    uniqueIndex('uq_ti_order').on(t.orderId),
  ],
);

// ────────────────────────────────────────────
// 2️⃣ 세금계산서 상태 이벤트 로그 (선택사항, Audit 용)
// ────────────────────────────────────────────

export const taxInvoiceEvents = pgTable(
  'tax_invoice_events',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),

    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => taxInvoices.id, { onDelete: 'cascade' }),

    // 이벤트 타입 (비즈니스 관점)
    eventType: varchar('event_type', { length: 32 }).notNull(),
    // ex) REQUESTED | EXPORTED | ISSUED_CONFIRMED | FAILED | CANCELLED | NEEDS_MODIFICATION

    // 상태 변경 추적
    previousStatus: varchar('previous_status', { length: 32 }),
    newStatus: varchar('new_status', { length: 32 }),

    // 금액 변경 추적 (수정세금계산서 등)
    previousAmount: bigint('previous_amount', { mode: 'number' }),
    newAmount: bigint('new_amount', { mode: 'number' }),

    // 원인 코드 / 상세
    reasonCode: varchar('reason_code', { length: 32 }),
    // ex) CUSTOMER_REQUEST | WRONG_AMOUNT | SYSTEM_ERROR | ADMIN_ACTION
    reasonDetail: text('reason_detail'),

    // 실행자 (USER / ADMIN / SYSTEM / CRON / 등)
    actor: varchar('actor', { length: 64 }).notNull().default('SYSTEM'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_tie_invoice').on(t.invoiceId),
    index('idx_tie_type').on(t.eventType),
    index('idx_tie_created').on(t.createdAt),
  ],
);

// ────────────────────────────────────────────
// 3️⃣ 발행 당시 전체 스냅샷 (JSON payload)
// ────────────────────────────────────────────
//
// - 주문/주문라인/배송/사업자/결제 등
//   "우리가 홈택스로 던지려는 최종 DTO"를 그대로 저장
// - payload 스키마는 앱 레벨에서 타입으로 관리

export const taxInvoiceSnapshots = pgTable(
  'tax_invoice_snapshots',
  {
    invoiceId: varchar('invoice_id', { length: 36 })
      .primaryKey()
      .references(() => taxInvoices.id, { onDelete: 'cascade' }),

    payload: jsonb('payload').notNull(), // { order, lines, businessInfo, amounts, ... }

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tis_invoice').on(t.invoiceId)],
);

// ────────────────────────────────────────────
// 4️⃣ 사용자 세금계산서 기본 설정 (Preference)
// ────────────────────────────────────────────

export const userTaxInvoicePreferences = pgTable('user_tax_invoice_preferences', {
  userId: varchar('user_id', { length: 64 }).primaryKey(),

  // 기본 신청 여부 (true면 주문 시 자동 신청 체크)
  defaultEnabled: integer('default_enabled').notNull().default(0), // 0=false, 1=true (boolean 대신 integer로 가면 driz + pg 쉽게)

  // 기본 사용할 사업자 정보 (스냅샷 아님, 설정용)
  defaultBusinessInfo: jsonb('default_business_info'),
  // { name, businessNumber, address, ownerName }

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
    merchantReferenceId: varchar('merchant_reference_id', { length: 128 }),
    referenceType: varchar('reference_type', { length: 32 }).default('ORDER'),
    // 금액 필드 (포인트 통합 지원) - 모두 정수(원 단위)로 통일
    discountAmount: bigint('discount_amount', { mode: 'number' }).notNull(),
    originalAmount: bigint('original_amount', { mode: 'number' }).notNull(),
    finalAmount: bigint('final_amount', { mode: 'number' }).notNull(), // 실제 결제액 (totalAmount - discountsTotal)

    status: paymentIntentStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    remainingAmount: bigint('remaining_amount', { mode: 'number' }).default(0), // 남은 결제액 복합결제 때문에 도입
  },
  (table) => [
    index('idx_payment_intents_customer_id').on(table.customerId),
    index('idx_payment_intents_status').on(table.status),
    index('idx_payment_intents_merchant_reference_id').on(table.merchantReferenceId),
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
    provider: paymentProviderEnum('provider').notNull(),
    transactionId: varchar('transaction_id', { length: 255 }),
    approvalNumber: varchar('approval_number', { length: 255 }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    status: transactionStatusEnum('status').notNull(),
    actor: text('actor').$type<'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN'>().notNull().default('USER'),
    request_payload: jsonb('request_payload'),
    provider_raw_response: jsonb('provider_raw_response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_payment_attempts_intent_created').on(table.intentId, table.createdAt)],
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
    refundAccountId: varchar('refund_account_id', { length: 36 }).references(() => userRefundAccounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_payment_refunds_intent_id').on(table.intentId),
    index('idx_payment_refunds_attempt_id').on(table.attemptId),
    index('idx_payment_refunds_status').on(table.status),
  ],
);

export const taxInvoicesRelations = relations(taxInvoices, ({ one, many }) => ({
  detail: one(taxInvoiceSnapshots, {
    fields: [taxInvoices.id],
    references: [taxInvoiceSnapshots.invoiceId],
  }),
  events: many(taxInvoiceEvents),
}));

export const taxInvoiceEventsRelations = relations(taxInvoiceEvents, ({ one }) => ({
  invoice: one(taxInvoices, {
    fields: [taxInvoiceEvents.invoiceId],
    references: [taxInvoices.id],
  }),
}));

export const cashReceiptEventsRelations = relations(cashReceiptEvents, ({ one }) => ({
  eventDetails: one(cashReceiptEventDetails, {
    fields: [cashReceiptEvents.id],
    references: [cashReceiptEventDetails.eventId],
  }),
}));

// BNPL View들 제거됨 - 물리테이블만 사용
// settlement_batch = BNPL Invoice
// settlement_batch_item = BNPL Invoice Item
// settlement_process_event = BNPL Collection Event

// ═══════════════════════════════════════════════
// OUTBOX EVENTS (Transactional Outbox Pattern)
// ═══════════════════════════════════════════════
/**
 * Outbox Events 테이블
 *
 * 목적: DB 트랜잭션과 이벤트 발행의 원자성 보장
 * - DB 변경과 이벤트 저장을 동일 트랜잭션에서 처리
 * - OutboxDispatcher가 주기적으로 폴링하여 Kafka로 발행
 * - 이벤트 손실 방지 및 재시도 메커니즘
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 36 }).notNull(),
    partitionKey: varchar('partition_key', { length: 128 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxStatusNext: index('idx_outbox_status_next').on(t.status, t.nextAttemptAt),
  }),
);

export const userPaymentPasswords = pgTable(
  'user_payment_passwords',
  {
    userId: varchar('user_id', { length: 64 }).primaryKey(), // FK to users table

    // 비밀번호 해시 (폐기 시 NULL 처리 가능하도록 nullable 고려하거나, LOCKED 상태로 관리)
    passwordHash: varchar('password_hash', { length: 60 }).notNull(),

    // 실패 횟수 (0~5)
    failureCount: integer('failure_count').notNull().default(0),

    // 상태 관리 (CTO 요구사항: 폐기 로직 대응)
    status: varchar('status', { length: 20 }).$type<'ACTIVE' | 'LOCKED'>().notNull().default('ACTIVE'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // 필요 시 인덱스 추가
  ],
);

export const pinAccessLogs = pgTable('pin_access_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull(),

  isSuccess: boolean('is_success').notNull(),
  failureCountSnapshot: integer('failure_count_snapshot'), // 당시 누적 실패 횟수

  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  attemptAt: timestamp('attempt_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pinHistory = pgTable('pin_history', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
  userId: varchar('user_id', { length: 64 }).notNull(),

  actionType: varchar('action_type', { length: 20 })
    .$type<'REGISTER' | 'CHANGE' | 'RESET' | 'LOCKED_DISPOSAL'>()
    .notNull(),

  // 보안상 해시값만 저장 (선택 사항)
  previousHash: varchar('previous_hash', { length: 60 }),

  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  changedByIp: varchar('changed_by_ip', { length: 45 }),
});

// ═══════════════════════════════════════════════
// 전체 스키마 객체 Export (Drizzle ORM 규칙)
// ═══════════════════════════════════════════════
// 주의: DbService의 타입 체크를 위해 walletSchema만 사용하세요
// import * as schema를 사용하면 newMemberId 같은 함수도 포함되어 타입 에러 발생
export const walletSchema = {
  ...authorizationSchema, // authorization 스키마 병합
  // v2 Architecture Tables
  paymentIntents,
  paymentAttempts,
  paymentRefunds,

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
  taxInvoiceSnapshots,
  taxInvoiceEvents,

  // Outbox Pattern
  outboxEvents,

  idempotencyKeys,
  userPaymentPasswords,
  pinAccessLogs,
  pinHistory,
} as const;

export type WalletSchema = typeof walletSchema;

// 하위 호환성을 위한 default export (기존 import * as schema 지원)
// 단, DbService 타입 파라미터로는 walletSchema만 사용하세요
export default walletSchema;