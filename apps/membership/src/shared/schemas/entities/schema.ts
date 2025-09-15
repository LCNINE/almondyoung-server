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
 * Pause periods - 일시정지 기간으로 명확화
 */
export const pausePeriods = pgTable('pause_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id').notNull(), // users 테이블 참조
  startsAt: date('starts_at').notNull(),
  endsAt: date('ends_at').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Pause entitlement voids - 일시정지로 인한 권한 무효화
 */
export const pauseEntitlementVoids = pgTable('pause_entitlement_voids', {
  id: uuid('id').primaryKey().defaultRandom(),
  pauseId: uuid('pause_id')
    .notNull()
    .references(() => pausePeriods.id),
  entitlementId: uuid('entitlement_id')
    .notNull()
    .references(() => subscriptionEntitlement.id),
  originalEndsAt: date('original_ends_at').notNull(),
  adjustedEndsAt: date('adjusted_ends_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
  ({ one }) => ({
    plan: one(plan, {
      fields: [subscriptionContracts.planId],
      references: [plan.id],
    }),
    // 정기결제 Dunning 관계 (선택적)
    dunningQueue: one(membershipDunningQueue, {
      fields: [subscriptionContracts.id],
      references: [membershipDunningQueue.contractId],
    }),
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
    pauseVoids: many(pauseEntitlementVoids),
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

export const pausePeriodsRelations = relations(pausePeriods, ({ many }) => ({
  entitlementVoids: many(pauseEntitlementVoids),
}));

export const pauseEntitlementVoidsRelations = relations(
  pauseEntitlementVoids,
  ({ one }) => ({
    pause: one(pausePeriods, {
      fields: [pauseEntitlementVoids.pauseId],
      references: [pausePeriods.id],
    }),
    entitlement: one(subscriptionEntitlement, {
      fields: [pauseEntitlementVoids.entitlementId],
      references: [subscriptionEntitlement.id],
    }),
  }),
);

// =================================================================
// 정기결제 Dunning 관리 (선택적)
// =================================================================

/**
 * Dunning 큐 - 결제 실패 시 재시도 스케줄 관리 (멤버십 도메인 전용)
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
