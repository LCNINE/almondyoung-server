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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
export const eventPublishStatusEnum = pgEnum('event_publish_status', [
  'PENDING',
  'PUBLISHED',
  'FAILED',
]);
export const pauseStatusEnum = pgEnum('pause_status', [
  'ACTIVE',
  'ENDED',
  'CANCELLED',
]);
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Subscription contracts - 계약 개념으로 명확화
 */
export const subscriptionContracts = pgTable('subscription_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id').notNull(), // users 테이블 참조
  planId: uuid('plan_id')
    .notNull()
    .references(() => plan.id),
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Pause events - 일시정지 이벤트 (CTO 스타일)
 */
export const pauseEvents = pgTable(
  'pause_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id').notNull(), // 유저 FK
    entitlementId: uuid('entitlement_id').references(
      () => subscriptionEntitlement.id,
    ), // 권한 FK
    eventType: text('event_type').notNull(), // START, EXTEND, CANCEL 등
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(), // 적용일
    previousEventId: uuid('previous_event_id').references(() => pauseEvents.id), // 연장·취소 시 원본 이벤트
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
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

export const subscriptionContractsRelations = relations(
  subscriptionContracts,
  ({ one, many }) => ({
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
  }),
);

export const subscriptionEntitlementRelations = relations(
  subscriptionEntitlement,
  ({ one, many }) => ({
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
  }),
);

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

export const pauseEventDetailsRelations = relations(
  pauseEventDetails,
  ({ one }) => ({
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
  }),
);

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
    .references(() => subscriptionContracts.id),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
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
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('idx_billing_events_contract').on(table.contractId)],
);

// Dunning Queue Relations
export const membershipDunningQueueRelations = relations(
  membershipDunningQueue,
  ({ one }) => ({
    contract: one(subscriptionContracts, {
      fields: [membershipDunningQueue.contractId],
      references: [subscriptionContracts.id],
    }),
  }),
);

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
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
