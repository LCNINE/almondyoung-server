import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  boolean,
  date,
  pgEnum,
  jsonb,
  varchar,
  index,
  uniqueIndex,
  primaryKey,
  serial,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { authorizationSchema } from '@app/authorization';

// ... 나머지 테이블에 대한 relations도 유사하게 정의할 수 있습니다.
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
  'PENDING_CHANGE',
]);
export const subscriptionChangeTypeEnum = pgEnum('subscription_change_type', [
  'UPGRADE',
  'DOWNGRADE',
  'RENEWAL',
  'INITIAL',
]);
export const eventPublishStatusEnum = pgEnum('event_publish_status', ['PENDING', 'PUBLISHED', 'FAILED']);
export const pauseStatusEnum = pgEnum('pause_status', ['ACTIVE', 'ENDED', 'CANCELLED']);
/**
 * Policy rule type enumeration for subscription management system.
 * Defines various policy types that can be applied to subscriptions, plans, and users.
 */
export const policyRuleTypeEnum = pgEnum('policy_rule_type', [
  // Pause-related policies
  'MAX_PAUSES_PER_YEAR',
  'MIN_PAUSE_DURATION_DAYS',
  'MAX_PAUSE_DURATION_DAYS',
  'PAUSE_COOLDOWN_DAYS',
  'PAUSE_BLACKOUT_PERIODS',

  // Plan change policies
  'PLAN_CHANGE_COOLDOWN_DAYS',
  'ALLOWED_PLAN_CHANGES',
  'DOWNGRADE_RESTRICTIONS',
  'UPGRADE_BENEFITS',

  // Tier-specific policies
  'TIER_SPECIFIC_LIMITS',
  'VIP_USER_BENEFITS',
  'NEW_USER_GRACE_PERIOD',

  // Promotional policies
  'PROMOTIONAL_PERIODS',
  'SEASONAL_RESTRICTIONS',
  'SPECIAL_EVENT_RULES',

  // Refund policies
  'TRIAL_REFUND_ENABLED',
  'RESUBSCRIPTION_REFUND_WINDOW_HOURS',
  'BENEFIT_USAGE_AFFECTS_REFUND',
  'PARTIAL_REFUND_CALCULATION_METHOD',
  'REFUND_PROCESSING_DAYS',

  // Trial policies
  'TRIAL_DURATION_DAYS',
  'TRIAL_REUSE_PREVENTION',
  'TRIAL_COOLDOWN_DAYS',
]);
// =================================================================
// Users (기존 유지)
// =================================================================

// =================================================================
// 새로운 7개 테이블 구조
// =================================================================

/**
 * Tiers - 더 직관적인 네이밍
 */
export const tiers = pgTable('tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  priorityLevel: integer('priority_level').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Plan - 단수형으로 더 직관적
 */
export const plan = pgTable('plan', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: uuid('tier_id')
    .notNull()
    .references(() => tiers.id),
  price: integer('price').notNull(),
  durationDays: integer('duration_days').notNull(),
  currency: text('currency').notNull().default('KRW'),
  trialDays: integer('trial_days').default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Subscription contracts - 계약 개념으로 명확화
 */
export const subscriptionContracts = pgTable(
  'subscription_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id').notNull(), // users 테이블 참조
    planId: uuid('plan_id')
      .notNull()
      .references(() => plan.id),
    billingDate: date('billing_date').notNull(), // 첫 결제일 (30일 주기 기준점)
    nextBillingDate: date('next_billing_date'),
    leadDays: integer('lead_days').notNull().default(0),
    isVoided: boolean('is_voided').notNull().default(false),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    reason: text('reason'),
    // 정기결제 연동 필드 (최소한의 메타데이터)
    lastPaymentIntentId: text('last_payment_intent_id'), // 마지막 결제 Intent ID
    lastPaymentAttemptId: text('last_payment_attempt_id'), // 마지막 결제 Attempt ID
    paymentProfileId: text('payment_profile_id'), // 저장된 결제 프로필 ID
    isPastDue: boolean('is_past_due').notNull().default(false), // 연체 상태
    billingRetryCount: integer('billing_retry_count').notNull().default(0), // 현재 재시도 횟수
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // 취소 및 환불 관련 필드
    status: text('status').notNull().default('ACTIVE'), // 'ACTIVE', 'CANCELLED', 'EXPIRED'
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReasonCode: text('cancellation_reason_code'),
    refundRequested: boolean('refund_requested').notNull().default(false),
    refundRequestedAt: timestamp('refund_requested_at', { withTimezone: true }),
    eligibleRefundAmount: integer('eligible_refund_amount'),
    refundCompleted: boolean('refund_completed').notNull().default(false),
    refundCompletedAt: timestamp('refund_completed_at', { withTimezone: true }),
    walletReferenceId: text('wallet_reference_id'),
    lastEventId: integer('last_event_id'),
    // 정기결제 중단 관련 필드
    recurringCancelledAt: timestamp('recurring_cancelled_at', {
      withTimezone: true,
    }),
    recurringCancellationReasonCode: text('recurring_cancellation_reason_code'),
    autoRenewal: boolean('auto_renewal').notNull().default(true),
    // 결제 커맨드 발행 후 결과 이벤트 수신 전까지 true — 스케줄러 중복 실행 방지
    billingInProgress: boolean('billing_in_progress').notNull().default(false),
    // billingInProgress=true로 전환된 시각. updatedAt은 다른 업데이트에 의해 덮힐 수 있어 별도 컬럼으로 관리
    billingStartedAt: timestamp('billing_started_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_subscription_billing_date').on(table.billingDate)],
);

/**
 * Subscription entitlement - 권한 개념으로 명확화
 */
export const subscriptionEntitlement = pgTable('subscription_entitlement', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id').notNull(), // users 테이블 참조
  tierId: uuid('tier_id')
    .notNull()
    .references(() => tiers.id),
  startsAt: date('starts_at').notNull(),
  endsAt: date('ends_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  isCurrent: boolean('is_current').notNull().default(true),
  sourceBatchId: uuid('source_batch_id').references(() => eventBatches.id),
  closedBatchId: uuid('closed_batch_id').references(() => eventBatches.id),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
});

/**
 * Event batches - 배치 개념으로 명확화
 */
export const eventBatches = pgTable('event_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  adminId: text('admin_id'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Cancellation reasons - 취소 이유 마스터 테이블
 */
export const cancellationReasons = pgTable('cancellation_reasons', {
  code: text('code').primaryKey(),
  displayText: text('display_text').notNull(),
  category: text('category').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Subscription contract events - 이벤트 소싱 패턴
 */
export const subscriptionContractEvents = pgTable(
  'subscription_contract_events',
  {
    id: serial('id').primaryKey(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => subscriptionContracts.id),
    eventType: text('event_type').notNull(),
    userId: varchar('user_id').notNull(),
    metadata: jsonb('metadata').notNull(),
    batchId: uuid('batch_id').references(() => eventBatches.id),
    causedBy: text('caused_by').notNull(),
    causedByUserId: text('caused_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_contract_events_contract_id').on(table.contractId),
    index('idx_contract_events_user_id').on(table.userId),
    index('idx_contract_events_type').on(table.eventType),
  ],
);

/**
 * Pause events - 일시정지 이벤트 (CTO 스타일)
 */
export const pauseEvents = pgTable(
  'pause_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id').notNull(), // 유저 FK
    entitlementId: uuid('entitlement_id').references(() => subscriptionEntitlement.id), // 권한 FK
    eventType: text('event_type').notNull(), // START, EXTEND, CANCEL 등
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(), // 적용일
    previousEventId: uuid('previous_event_id').references(() => pauseEvents.id), // 연장·취소 시 원본 이벤트
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_pause_events_user').on(table.userId),
    index('idx_pause_events_entitlement').on(table.entitlementId),
    // 유저별 같은 날짜에 중복 이벤트를 막기 위한 유니크 제약(필요시)
    // uniqueIndex('uniq_pause_user_date').on(table.userId, table.effectiveAt),
  ],
);

/**
 * Pause event details - 일시정지 이벤트 상세 (권한 조정 추적)
 */
export const pauseEventDetails = pgTable(
  'pause_event_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pauseEventId: uuid('pause_event_id')
      .notNull()
      .references(() => pauseEvents.id),
    userId: varchar('user_id').notNull(), // 성능 위해 중복 저장
    entitlementId: uuid('entitlement_id')
      .notNull()
      .references(() => subscriptionEntitlement.id),
    adjustmentDays: integer('adjustment_days').notNull(), // 몇 일 조정했는지
    originalDetailId: uuid('original_detail_id') // 원본 detail 추적(취소/연장)
      .references(() => pauseEventDetails.id),
    startsAt: date('starts_at').notNull(), // 일시정지 시작일
    endsAt: date('ends_at').notNull(), // 일시정지 종료일
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_pause_event_details_user').on(table.userId),
    index('idx_pause_event_details_entitlement').on(table.entitlementId),
    index('idx_pause_event_details_original').on(table.originalDetailId),
    index('idx_pause_event_details_pause_event').on(table.pauseEventId),
  ],
);

// =================================================================
// Drizzle ORM Relations (선택 사항이지만, 쿼리 시 유용)
// src/schemas/relations.ts
// =================================================================

// =================================================================
// Relations for New Schema
// =================================================================

export const tiersRelations = relations(tiers, ({ many }) => ({
  plans: many(plan),
  entitlements: many(subscriptionEntitlement),
}));

export const planRelations = relations(plan, ({ one, many }) => ({
  tier: one(tiers, {
    fields: [plan.tierId],
    references: [tiers.id],
  }),
  contracts: many(subscriptionContracts),
}));

export const subscriptionContractsRelations = relations(subscriptionContracts, ({ one, many }) => ({
  plan: one(plan, {
    fields: [subscriptionContracts.planId],
    references: [plan.id],
  }),
  // 정기결제 Dunning 관계 (선택적)
  dunningQueue: one(membershipDunningQueue, {
    fields: [subscriptionContracts.id],
    references: [membershipDunningQueue.contractId],
  }),
  billingEvents: many(billingEvents),
}));

export const subscriptionEntitlementRelations = relations(subscriptionEntitlement, ({ one, many }) => ({
  tier: one(tiers, {
    fields: [subscriptionEntitlement.tierId],
    references: [tiers.id],
  }),
  sourceBatch: one(eventBatches, {
    fields: [subscriptionEntitlement.sourceBatchId],
    references: [eventBatches.id],
  }),
  closedBatch: one(eventBatches, {
    fields: [subscriptionEntitlement.closedBatchId],
    references: [eventBatches.id],
  }),
  pauseEventDetails: many(pauseEventDetails),
}));

export const eventBatchesRelations = relations(eventBatches, ({ many }) => ({
  sourceEntitlements: many(subscriptionEntitlement, {
    relationName: 'sourceEntitlements',
  }),
  closedEntitlements: many(subscriptionEntitlement, {
    relationName: 'closedEntitlements',
  }),
}));

export const pauseEventsRelations = relations(pauseEvents, ({ one, many }) => ({
  entitlement: one(subscriptionEntitlement, {
    fields: [pauseEvents.entitlementId],
    references: [subscriptionEntitlement.id],
  }),
  previousEvent: one(pauseEvents, {
    fields: [pauseEvents.previousEventId],
    references: [pauseEvents.id],
  }),
  eventDetails: many(pauseEventDetails),
}));

export const pauseEventDetailsRelations = relations(pauseEventDetails, ({ one }) => ({
  pauseEvent: one(pauseEvents, {
    fields: [pauseEventDetails.pauseEventId],
    references: [pauseEvents.id],
  }),
  entitlement: one(subscriptionEntitlement, {
    fields: [pauseEventDetails.entitlementId],
    references: [subscriptionEntitlement.id],
  }),
  originalDetail: one(pauseEventDetails, {
    fields: [pauseEventDetails.originalDetailId],
    references: [pauseEventDetails.id],
  }),
}));

// =================================================================
// 정기결제 Dunning 관리 (선택적)
// =================================================================

/**
 * Dunning 큐 - 결제 실패 시 재시도 스케줄 관리
 */
export const membershipDunningQueue = pgTable('membership_dunning_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id')
    .notNull()
    .unique()
    .references(() => subscriptionContracts.id),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 결제 이벤트 테이블
 */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => subscriptionContracts.id),
    eventType: text('event_type').notNull(), // CHARGE_ATTEMPT, CHARGE_SUCCESS, CHARGE_FAIL
    attemptNo: integer('attempt_no'),
    amount: integer('amount'),
    paymentIntentId: text('payment_intent_id'), // wallet intentId — 결과 이벤트 재전달 멱등 키
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_billing_events_contract').on(table.contractId),
    // 결과 이벤트 재전달 멱등: 같은 intent의 동일 결과를 한 번만 기록 (payment_intent_id NULL은 중복 허용)
    uniqueIndex('uq_billing_events_intent_result').on(table.contractId, table.paymentIntentId, table.eventType),
  ],
);

// Dunning Queue Relations
export const membershipDunningQueueRelations = relations(membershipDunningQueue, ({ one }) => ({
  contract: one(subscriptionContracts, {
    fields: [membershipDunningQueue.contractId],
    references: [subscriptionContracts.id],
  }),
}));

// Billing Events Relations
export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
  contract: one(subscriptionContracts, {
    fields: [billingEvents.contractId],
    references: [subscriptionContracts.id],
  }),
}));

// 구독정책

export const subscriptionPolicies = pgTable('subscription_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleType: policyRuleTypeEnum('rule_type').notNull(),
  ruleValue: jsonb('rule_value').notNull(),
  tierId: uuid('tier_id').references(() => tiers.id), // tierId가 NULL이면 모든 티어에 적용
  isActive: boolean('is_active').default(true).notNull(),
  validFrom: date('valid_from'),
  validUntil: date('valid_until'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// =================================================================
// 멤버십 혜택 추적 (Membership Benefits Tracking)
// =================================================================

/**
 * 주기별 혜택 집계 테이블 - 30일 주기 단위 총 절약 금액
 */
export const membershipCycleBenefits = pgTable(
  'membership_cycle_benefits',
  {
    userId: varchar('user_id').notNull(),
    cycleStartDate: date('cycle_start_date').notNull(), // 집계주기(o) 결제주기(x)
    cycleEndDate: date('cycle_end_date').notNull(), // 집계주기(o) 결제주기(x)
    totalDiscountAmount: integer('total_discount_amount').notNull().default(0),
    orderCount: integer('order_count').notNull().default(0),
    subscriptionId: varchar('subscription_id').notNull(),
    cycleNumber: integer('cycle_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.cycleStartDate] }),
    index('idx_cycle_subscription').on(table.subscriptionId),
    index('idx_cycle_end_date').on(table.cycleEndDate),
  ],
);

/**
 * 주문별 할인 이벤트 테이블 - 멱등성 보장 및 취소 처리
 * 추후 베네핏을 pk로 참조하는것도 고려해볼만함.
 */
export const membershipDiscountEvents = pgTable(
  'membership_discount_events',
  {
    orderId: varchar('order_id', { length: 100 }).primaryKey(),
    userId: varchar('user_id').notNull(),
    discountAmount: integer('discount_amount').notNull(),
    tierId: uuid('tier_id').notNull(),
    cycleStartDate: date('cycle_start_date').notNull(),
    subscriptionId: varchar('subscription_id').notNull(),
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    isCancelled: boolean('is_cancelled').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_events_user_cycle').on(table.userId, table.cycleStartDate),
    index('idx_events_subscription').on(table.subscriptionId),
    index('idx_events_cancelled').on(table.isCancelled),
  ],
);

// Relations for Benefits Tracking
export const membershipCycleBenefitsRelations = relations(membershipCycleBenefits, ({ one }) => ({
  subscription: one(subscriptionContracts, {
    fields: [membershipCycleBenefits.subscriptionId],
    references: [subscriptionContracts.id],
  }),
}));

export const membershipDiscountEventsRelations = relations(membershipDiscountEvents, ({ one }) => ({
  subscription: one(subscriptionContracts, {
    fields: [membershipDiscountEvents.subscriptionId],
    references: [subscriptionContracts.id],
  }),
  tier: one(tiers, {
    fields: [membershipDiscountEvents.tierId],
    references: [tiers.id],
  }),
}));

// =================================================================
// 웰컴 멤버십 구매 자격 테이블
// =================================================================

/**
 * 사용자별 웰컴 멤버십 상품 구매 자격 테이블
 *
 * has_purchased = false (or 행 없음) → 구매 가능
 * has_purchased = true              → 이미 구매함, 재구매 불가
 *
 * 데이터 출처:
 *   - 'cafe24'      : 카페24 주문 이력에서 마이그레이션
 *   - 'medusa'      : 새 시스템(Medusa)에서 구매 시 기록
 */
export const welcomeMembershipEligibility = pgTable(
  'welcome_membership_eligibility',
  {
    userId: uuid('user_id').primaryKey(),
    hasPurchased: boolean('has_purchased').notNull().default(false),
    purchaseSource: text('purchase_source').notNull().default('cafe24'), // 'cafe24' | 'medusa'
    firstOrderId: text('first_order_id'),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_wm_eligibility_has_purchased').on(table.hasPurchased)],
);

// ===============================
// 전체 스키마 객체 Export (Drizzle ORM 규칙)
// ===============================
// 주의: DbService의 타입 체크를 위해 membershipSchema만 사용하세요
// import * as schema를 사용하면 Enum들도 포함되어 타입 에러 발생
export const membershipSchema = {
  // Tables
  tiers,
  plan,
  subscriptionContracts,
  subscriptionEntitlement,
  eventBatches,
  cancellationReasons,
  subscriptionContractEvents,
  pauseEvents,
  pauseEventDetails,
  membershipDunningQueue,
  billingEvents,
  subscriptionPolicies,
  membershipCycleBenefits,
  membershipDiscountEvents,
  welcomeMembershipEligibility,

  // Relations
  tiersRelations,
  planRelations,
  subscriptionContractsRelations,
  subscriptionEntitlementRelations,
  eventBatchesRelations,
  pauseEventsRelations,
  pauseEventDetailsRelations,
  membershipDunningQueueRelations,
  billingEventsRelations,
  membershipCycleBenefitsRelations,
  membershipDiscountEventsRelations,

  // Auth Schema (from @app/authorization)
  ...authorizationSchema,
} as const;

export type MembershipSchema = typeof membershipSchema;
