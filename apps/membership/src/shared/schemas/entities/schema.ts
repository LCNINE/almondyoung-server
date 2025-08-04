import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  boolean,
  date,
  jsonb,
  uniqueIndex,
  pgEnum,
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
// Enums (공통으로 사용될 상태 값 등)
// src/schemas/enums.ts
// =================================================================

// =================================================================
// Users
// src/schemas/users.schema.ts
// =================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// =================================================================
// Tiers & Plans
// src/schemas/tiers.schema.ts
// =================================================================

export const subscriptionTiers = pgTable('subscription_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  priorityLevel: integer('priority_level').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// src/schemas/plans.schema.ts
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: uuid('tier_id')
    .notNull()
    .references(() => subscriptionTiers.id),
  price: integer('price').notNull(),
  durationDays: integer('duration_days').notNull(),
  currency: text('currency').notNull().default('KRW'),
  isActive: boolean('is_active').default(true).notNull(),
  trialDays: integer('trial_days').default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// =================================================================
// Subscriptions
// src/schemas/subscriptions.schema.ts
// =================================================================

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  planId: uuid('plan_id')
    .notNull()
    .references(() => subscriptionPlans.id),
  status: subscriptionStatusEnum('status').notNull(),
  startedAt: date('started_at').notNull(),
  nextBillingDate: date('next_billing_date'),
  previousSubscriptionId: uuid('previous_subscription_id').references(
    (): any => subscriptions.id,
  ), // Self-referencing
  changeType: subscriptionChangeTypeEnum('change_type'),
  adjustmentAmount: integer('adjustment_amount'),
  isVoided: boolean('is_voided').default(false).notNull(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// =================================================================
// Rights & Events
// src/schemas/rights.schema.ts
// =================================================================

export const subscriptionRights = pgTable('subscription_rights', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tierId: uuid('tier_id')
    .notNull()
    .references(() => subscriptionTiers.id),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  startsAt: date('starts_at').notNull(),
  endsAt: date('ends_at').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  pausedAt: timestamp('paused_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdByEventId: uuid('created_by_event_id').references(
    (): any => subscriptionEvents.id,
  ),
  closedByEventId: uuid('closed_by_event_id').references(
    (): any => subscriptionEvents.id,
  ),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// src/schemas/events.schema.ts
export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id),
  effectiveDate: date('effective_date').notNull(),
  eventPayload: jsonb('event_payload').notNull(),
  initiatedBy: uuid('initiated_by'), // Could be user or admin ID
  topicName: text('topic_name'),
  publishStatus: eventPublishStatusEnum('publish_status')
    .default('PENDING')
    .notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retryCount: integer('retry_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// =================================================================
// Pauses
// src/schemas/pauses.schema.ts
// =================================================================

export const subscriptionPauses = pgTable('subscription_pauses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  startsAt: date('starts_at').notNull(),
  endsAt: date('ends_at').notNull(),
  actualResumedAt: date('actual_resumed_at'),
  status: pauseStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// src/schemas/pause-affected-rights.schema.ts
export const pauseAffectedRights = pgTable('pause_affected_rights', {
  id: uuid('id').primaryKey().defaultRandom(),
  pauseId: uuid('pause_id')
    .notNull()
    .references(() => subscriptionPauses.id),
  rightId: uuid('right_id')
    .notNull()
    .references(() => subscriptionRights.id),
  originalEndsAt: date('original_ends_at').notNull(),
  adjustedEndsAt: date('adjusted_ends_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// src/schemas/pause-usage-tracker.schema.ts
export const pauseUsageTracker = pgTable(
  'pause_usage_tracker',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    year: integer('year').notNull(),
    pauseCount: integer('pause_count').default(0).notNull(),
    totalPausedDays: integer('total_paused_days').default(0).notNull(),
    lastPauseDate: date('last_pause_date'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userYearUnq: uniqueIndex('user_year_unq').on(table.userId, table.year),
  }),
);

// =================================================================
// Policies
// src/schemas/policies.schema.ts
// =================================================================

export const subscriptionPolicies = pgTable('subscription_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleType: policyRuleTypeEnum('rule_type').notNull(),
  ruleValue: jsonb('rule_value').notNull(),
  tierId: uuid('tier_id').references(() => subscriptionTiers.id), // tierId가 NULL이면 모든 티어에 적용
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

// =================================================================
// Drizzle ORM Relations (선택 사항이지만, 쿼리 시 유용)
// src/schemas/relations.ts
// =================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  subscriptions: many(subscriptions),
  subscriptionRights: many(subscriptionRights),
  subscriptionEvents: many(subscriptionEvents),
  subscriptionPauses: many(subscriptionPauses),
  pauseUsageTrackers: many(pauseUsageTracker),
}));

export const subscriptionTiersRelations = relations(
  subscriptionTiers,
  ({ many }) => ({
    subscriptionPlans: many(subscriptionPlans),
    subscriptionRights: many(subscriptionRights),
    subscriptionPolicies: many(subscriptionPolicies),
  }),
);


