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
  serial, // Supabase에서 사용하는 serial 추가
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
export const bnplAccountStatusEnum = pgEnum('bnpl_account_status', [
  'ACTIVE',
  'SUSPENDED',
  'OVERDUE',
]);

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
  'bnpl_account',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()), // 통일
    userId: varchar('user_id', { length: 64 }).notNull(),
    paymentProfileId: varchar('payment_profile_id', { length: 36 })
      .notNull()
      .references(() => paymentProfiles.id),
    creditLimit: bigint('credit_limit', { mode: 'number' }).notNull(),
    approvedLimit: bigint('approved_limit', { mode: 'number' }).notNull(),
    status: bnplAccountStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('idx_bnpl_account_user_unique').on(table.userId)],
);

export const bnplEvents = pgTable('bnpl_events', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
  bnplAccountId: varchar('bnpl_account_id', { length: 36 })
    .notNull()
    .references(() => bnplAccounts.id),
  paymentSessionId: varchar('payment_session_id', { length: 36 }).notNull(),
  transactionType: text('transaction_type')
    .$type<'DEBIT' | 'CREDIT'>()
    .notNull(),
  status: transactionStatusEnum('status').notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ────────────────────────────────────────────
// BNPL Invoice & Collection Schemas (리뉴얼.md 기준 물리테이블)
// ────────────────────────────────────────────

export const bnplInvoices = pgTable('bnpl_invoices', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
  bnplAccountId: varchar('bnpl_account_id', { length: 36 })
    .notNull()
    .references(() => bnplAccounts.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull().default(0),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: text('status')
    .$type<'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'>()
    .notNull()
    .default('PENDING'),
  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bnplInvoiceItems = pgTable('bnpl_invoice_items', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(generateUUIDv7),
  invoiceId: varchar('invoice_id', { length: 36 })
    .notNull()
    .references(() => bnplInvoices.id),
  bnplEventId: varchar('bnpl_event_id', { length: 36 })
    .notNull()
    .references(() => bnplEvents.id),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  transactionDate: timestamp('transaction_date', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
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

// ────────────────────────────────────────────
// Relations
// ────────────────────────────────────────────

// Payment method relations - 정규화된 구조 (임시 비활성화)
// export const paymentProfilesRelations = relations(
//   paymentProfiles,
//   ({ one }) => ({
//     card: one(cmsCardProfiles, {
//       fields: [paymentProfiles.id],
//       references: [cmsCardProfiles.id],
//     }),
//     batch: one(cmsBatchProfiles, {
//       fields: [paymentProfiles.id],
//       references: [cmsBatchProfiles.id],
//     }),
//   }),
// );

// export const cmsCardProfilesRelations = relations(
//   cmsCardProfiles,
//   ({ one }) => ({
//     paymentProfile: one(paymentProfiles, {
//       fields: [cmsCardProfiles.id],
//       references: [paymentProfiles.id],
//     }),
//   }),
// );

// export const cmsBatchProfilesRelations = relations(
//   cmsBatchProfiles,
//   ({ one }) => ({
//     paymentProfile: one(paymentProfiles, {
//       fields: [cmsBatchProfiles.id],
//       references: [paymentProfiles.id],
//     }),
//   }),
// );

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
    id: varchar('id', { length: 36 }).primaryKey(),
    customerId: varchar('customer_id', { length: 64 }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
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
    eventContext: jsonb('event_context'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorMessage: text('error_message'),
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

// BNPL View들 제거됨 - 물리테이블만 사용
// settlement_batch = BNPL Invoice
// settlement_batch_item = BNPL Invoice Item
// settlement_process_event = BNPL Collection Event

// ===============================
// 전체 스키마 객체 Export (Drizzle ORM 규칙)
// ===============================
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

  // Refund System
  userRefundAccounts,

  // Point System
  pointEvents,
  pointEventDetails,

  // Utility Tables
  idempotencyKeys,
} as const;

export type WalletSchema = typeof walletSchema;
