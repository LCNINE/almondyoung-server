import {
  pgTable,
  uuid,
  timestamp,
  text,
  integer,
  boolean,
  date,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * New simplified schema for membership subscription system
 * Based on CTO-approved 7-table design
 */

// =================================================================
// Core Tables (New Schema)
// =================================================================

/**
 * Tiers table - simplified from subscription_tiers
 * Removed: name field (only code and rank needed)
 */
export const tiers = pgTable('tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  rank: integer('rank').notNull().unique(), // renamed from priority_level
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Plan table - simplified from subscription_plans
 * Removed: trial_days field
 */
export const plan = pgTable('plan', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: uuid('tier_id')
    .notNull()
    .references(() => tiers.id),
  price: integer('price').notNull(),
  durationDays: integer('duration_days').notNull(),
  currency: text('currency').notNull().default('KRW'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Subscription contracts - simplified from subscriptions
 * Removed: status, started_at, previous_subscription_id, change_type,
 *          adjustment_amount, void_reason, updated_at
 * Added: lead_days field
 */
export const subscriptionContracts = pgTable('subscription_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(), // references users(id) - assuming users table exists
  planId: uuid('plan_id')
    .notNull()
    .references(() => plan.id),
  nextBillingDate: date('next_billing_date'),
  leadDays: integer('lead_days').notNull().default(0), // new field
  isVoided: boolean('is_voided').notNull().default(false),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Subscription entitlement - evolved from subscription_rights
 * Added: closed_at, is_current, source_batch_id, closed_batch_id fields
 * Removed: subscription_id, is_active, created_by_event_id, closed_by_event_id
 */
export const subscriptionEntitlement = pgTable('subscription_entitlement', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(), // references users(id)
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
 * Event batches - simplified from subscription_events
 * Removed: user_id, subscription_id, event_payload, initiated_by,
 *          topic_name, publish_status, retry_count
 * Added: admin_id field
 * Renamed: event_type -> type
 */
export const eventBatches = pgTable('event_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // renamed from event_type
  adminId: uuid('admin_id'), // new field for admin who initiated the batch
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Pause periods - simplified from subscription_pauses
 * Removed: subscription_id, status, actual_resumed_at
 * Added: reason field
 */
export const pausePeriods = pgTable('pause_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(), // references users(id)
  startsAt: date('starts_at').notNull(),
  endsAt: date('ends_at').notNull(),
  reason: text('reason'), // new field for pause reason
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Pause entitlement voids - evolved from pause_affected_rights
 * Renamed: right_id -> entitlement_id
 */
export const pauseEntitlementVoids = pgTable('pause_entitlement_voids', {
  id: uuid('id').primaryKey().defaultRandom(),
  pauseId: uuid('pause_id')
    .notNull()
    .references(() => pausePeriods.id),
  entitlementId: uuid('entitlement_id') // renamed from right_id
    .notNull()
    .references(() => subscriptionEntitlement.id),
  originalEndsAt: date('original_ends_at').notNull(),
  adjustedEndsAt: date('adjusted_ends_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
