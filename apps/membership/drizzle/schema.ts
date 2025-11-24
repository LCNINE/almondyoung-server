import { pgTable, index, foreignKey, uuid, varchar, text, timestamp, date, boolean, unique, integer, jsonb, serial, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const eventPublishStatus = pgEnum("event_publish_status", ['PENDING', 'PUBLISHED', 'FAILED'])
export const pauseStatus = pgEnum("pause_status", ['ACTIVE', 'ENDED', 'CANCELLED'])
export const policyRuleType = pgEnum("policy_rule_type", ['MAX_PAUSES_PER_YEAR', 'MIN_PAUSE_DURATION_DAYS', 'MAX_PAUSE_DURATION_DAYS', 'PAUSE_COOLDOWN_DAYS', 'PAUSE_BLACKOUT_PERIODS', 'PLAN_CHANGE_COOLDOWN_DAYS', 'ALLOWED_PLAN_CHANGES', 'DOWNGRADE_RESTRICTIONS', 'UPGRADE_BENEFITS', 'TIER_SPECIFIC_LIMITS', 'VIP_USER_BENEFITS', 'NEW_USER_GRACE_PERIOD', 'PROMOTIONAL_PERIODS', 'SEASONAL_RESTRICTIONS', 'SPECIAL_EVENT_RULES', 'TRIAL_REFUND_ENABLED', 'RESUBSCRIPTION_REFUND_WINDOW_HOURS', 'BENEFIT_USAGE_AFFECTS_REFUND', 'PARTIAL_REFUND_CALCULATION_METHOD', 'REFUND_PROCESSING_DAYS', 'TRIAL_DURATION_DAYS', 'TRIAL_REUSE_PREVENTION', 'TRIAL_COOLDOWN_DAYS'])
export const subscriptionChangeType = pgEnum("subscription_change_type", ['UPGRADE', 'DOWNGRADE', 'RENEWAL', 'INITIAL'])
export const subscriptionStatus = pgEnum("subscription_status", ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PENDING_CHANGE'])


export const pauseEvents = pgTable("pause_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	entitlementId: uuid("entitlement_id"),
	eventType: text("event_type").notNull(),
	effectiveAt: timestamp("effective_at", { withTimezone: true, mode: 'string' }).notNull(),
	previousEventId: uuid("previous_event_id"),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pause_events_entitlement").using("btree", table.entitlementId.asc().nullsLast().op("uuid_ops")),
	index("idx_pause_events_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.entitlementId],
			foreignColumns: [subscriptionEntitlement.id],
			name: "pause_events_entitlement_id_subscription_entitlement_id_fk"
		}),
	foreignKey({
			columns: [table.previousEventId],
			foreignColumns: [table.id],
			name: "pause_events_previous_event_id_pause_events_id_fk"
		}),
]);

export const subscriptionEntitlement = pgTable("subscription_entitlement", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	tierId: uuid("tier_id").notNull(),
	startsAt: date("starts_at").notNull(),
	endsAt: date("ends_at").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	isCurrent: boolean("is_current").default(true).notNull(),
	sourceBatchId: uuid("source_batch_id"),
	closedBatchId: uuid("closed_batch_id"),
	pausedAt: timestamp("paused_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.tierId],
			foreignColumns: [tiers.id],
			name: "subscription_entitlement_tier_id_tiers_id_fk"
		}),
	foreignKey({
			columns: [table.sourceBatchId],
			foreignColumns: [eventBatches.id],
			name: "subscription_entitlement_source_batch_id_event_batches_id_fk"
		}),
	foreignKey({
			columns: [table.closedBatchId],
			foreignColumns: [eventBatches.id],
			name: "subscription_entitlement_closed_batch_id_event_batches_id_fk"
		}),
]);

export const tiers = pgTable("tiers", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	priorityLevel: integer("priority_level").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("tiers_code_unique").on(table.code),
	unique("tiers_priority_level_unique").on(table.priorityLevel),
]);

export const subscriptionPolicies = pgTable("subscription_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ruleType: policyRuleType("rule_type").notNull(),
	ruleValue: jsonb("rule_value").notNull(),
	tierId: uuid("tier_id"),
	isActive: boolean("is_active").default(true).notNull(),
	validFrom: date("valid_from"),
	validUntil: date("valid_until"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.tierId],
			foreignColumns: [tiers.id],
			name: "subscription_policies_tier_id_tiers_id_fk"
		}),
]);

export const membershipDunningQueue = pgTable("membership_dunning_queue", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contractId: uuid("contract_id").notNull(),
	nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: 'string' }).notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(3).notNull(),
	lastErrorCode: text("last_error_code"),
	lastErrorMessage: text("last_error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [subscriptionContracts.id],
			name: "membership_dunning_queue_contract_id_subscription_contracts_id_"
		}),
	unique("membership_dunning_queue_contract_id_unique").on(table.contractId),
]);

export const cancellationReasons = pgTable("cancellation_reasons", {
	code: text().primaryKey().notNull(),
	displayText: text("display_text").notNull(),
	category: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const membershipDiscountEvents = pgTable("membership_discount_events", {
	orderId: varchar("order_id", { length: 100 }).primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	discountAmount: integer("discount_amount").notNull(),
	tierId: uuid("tier_id").notNull(),
	cycleStartDate: date("cycle_start_date").notNull(),
	subscriptionId: varchar("subscription_id").notNull(),
	orderDate: timestamp("order_date", { withTimezone: true, mode: 'string' }).notNull(),
	isCancelled: boolean("is_cancelled").default(false).notNull(),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_events_cancelled").using("btree", table.isCancelled.asc().nullsLast().op("bool_ops")),
	index("idx_events_subscription").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	index("idx_events_user_cycle").using("btree", table.userId.asc().nullsLast().op("date_ops"), table.cycleStartDate.asc().nullsLast().op("date_ops")),
]);

export const pauseEventDetails = pgTable("pause_event_details", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pauseEventId: uuid("pause_event_id").notNull(),
	userId: varchar("user_id").notNull(),
	entitlementId: uuid("entitlement_id").notNull(),
	adjustmentDays: integer("adjustment_days").notNull(),
	originalDetailId: uuid("original_detail_id"),
	startsAt: date("starts_at").notNull(),
	endsAt: date("ends_at").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pause_event_details_entitlement").using("btree", table.entitlementId.asc().nullsLast().op("uuid_ops")),
	index("idx_pause_event_details_original").using("btree", table.originalDetailId.asc().nullsLast().op("uuid_ops")),
	index("idx_pause_event_details_pause_event").using("btree", table.pauseEventId.asc().nullsLast().op("uuid_ops")),
	index("idx_pause_event_details_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.pauseEventId],
			foreignColumns: [pauseEvents.id],
			name: "pause_event_details_pause_event_id_pause_events_id_fk"
		}),
	foreignKey({
			columns: [table.entitlementId],
			foreignColumns: [subscriptionEntitlement.id],
			name: "pause_event_details_entitlement_id_subscription_entitlement_id_"
		}),
	foreignKey({
			columns: [table.originalDetailId],
			foreignColumns: [table.id],
			name: "pause_event_details_original_detail_id_pause_event_details_id_f"
		}),
]);

export const eventBatches = pgTable("event_batches", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	type: text().notNull(),
	adminId: text("admin_id"),
	effectiveDate: date("effective_date").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const billingEvents = pgTable("billing_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contractId: uuid("contract_id").notNull(),
	eventType: text("event_type").notNull(),
	attemptNo: integer("attempt_no"),
	amount: integer(),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_billing_events_contract").using("btree", table.contractId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [subscriptionContracts.id],
			name: "billing_events_contract_id_subscription_contracts_id_fk"
		}),
]);

export const plan = pgTable("plan", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	tierId: uuid("tier_id").notNull(),
	price: integer().notNull(),
	durationDays: integer("duration_days").notNull(),
	currency: text().default('KRW').notNull(),
	trialDays: integer("trial_days").default(0),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.tierId],
			foreignColumns: [tiers.id],
			name: "plan_tier_id_tiers_id_fk"
		}),
]);

export const subscriptionContracts = pgTable("subscription_contracts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: varchar("user_id").notNull(),
	planId: uuid("plan_id").notNull(),
	billingDate: date("billing_date").notNull(),
	nextBillingDate: date("next_billing_date"),
	leadDays: integer("lead_days").default(0).notNull(),
	isVoided: boolean("is_voided").default(false).notNull(),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	reason: text(),
	lastPaymentIntentId: text("last_payment_intent_id"),
	lastPaymentAttemptId: text("last_payment_attempt_id"),
	paymentProfileId: text("payment_profile_id"),
	isPastDue: boolean("is_past_due").default(false).notNull(),
	billingRetryCount: integer("billing_retry_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: text().default('ACTIVE').notNull(),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancellationReasonCode: text("cancellation_reason_code"),
	refundRequested: boolean("refund_requested").default(false).notNull(),
	refundRequestedAt: timestamp("refund_requested_at", { withTimezone: true, mode: 'string' }),
	eligibleRefundAmount: integer("eligible_refund_amount"),
	refundCompleted: boolean("refund_completed").default(false).notNull(),
	refundCompletedAt: timestamp("refund_completed_at", { withTimezone: true, mode: 'string' }),
	walletReferenceId: text("wallet_reference_id"),
	lastEventId: integer("last_event_id"),
	recurringCancelledAt: timestamp("recurring_cancelled_at", { withTimezone: true, mode: 'string' }),
	recurringCancellationReasonCode: text("recurring_cancellation_reason_code"),
	autoRenewal: boolean("auto_renewal").default(true).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_subscription_billing_date").using("btree", table.billingDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plan.id],
			name: "subscription_contracts_plan_id_plan_id_fk"
		}),
]);

export const subscriptionContractEvents = pgTable("subscription_contract_events", {
	id: serial().primaryKey().notNull(),
	contractId: uuid("contract_id").notNull(),
	eventType: text("event_type").notNull(),
	userId: varchar("user_id").notNull(),
	metadata: jsonb().notNull(),
	batchId: uuid("batch_id"),
	causedBy: text("caused_by").notNull(),
	causedByUserId: text("caused_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_contract_events_contract_id").using("btree", table.contractId.asc().nullsLast().op("uuid_ops")),
	index("idx_contract_events_type").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("idx_contract_events_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.batchId],
			foreignColumns: [eventBatches.id],
			name: "subscription_contract_events_batch_id_event_batches_id_fk"
		}),
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [subscriptionContracts.id],
			name: "subscription_contract_events_contract_id_subscription_contracts"
		}),
]);

export const membershipCycleBenefits = pgTable("membership_cycle_benefits", {
	userId: varchar("user_id").notNull(),
	cycleStartDate: date("cycle_start_date").notNull(),
	cycleEndDate: date("cycle_end_date").notNull(),
	totalDiscountAmount: integer("total_discount_amount").default(0).notNull(),
	orderCount: integer("order_count").default(0).notNull(),
	subscriptionId: varchar("subscription_id").notNull(),
	cycleNumber: integer("cycle_number").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_cycle_end_date").using("btree", table.cycleEndDate.asc().nullsLast().op("date_ops")),
	index("idx_cycle_subscription").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	primaryKey({ columns: [table.userId, table.cycleStartDate], name: "membership_cycle_benefits_user_id_cycle_start_date_pk"}),
]);
