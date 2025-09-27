CREATE TYPE "public"."event_publish_status" AS ENUM('PENDING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pause_status" AS ENUM('ACTIVE', 'ENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."policy_rule_type" AS ENUM('MAX_PAUSES_PER_YEAR', 'MIN_PAUSE_DURATION_DAYS', 'MAX_PAUSE_DURATION_DAYS', 'PAUSE_COOLDOWN_DAYS', 'PAUSE_BLACKOUT_PERIODS', 'PLAN_CHANGE_COOLDOWN_DAYS', 'ALLOWED_PLAN_CHANGES', 'DOWNGRADE_RESTRICTIONS', 'UPGRADE_BENEFITS', 'TIER_SPECIFIC_LIMITS', 'VIP_USER_BENEFITS', 'NEW_USER_GRACE_PERIOD', 'PROMOTIONAL_PERIODS', 'SEASONAL_RESTRICTIONS', 'SPECIAL_EVENT_RULES');--> statement-breakpoint
CREATE TYPE "public"."subscription_change_type" AS ENUM('UPGRADE', 'DOWNGRADE', 'RENEWAL', 'INITIAL');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PENDING_CHANGE');--> statement-breakpoint
CREATE TABLE "event_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"admin_id" text,
	"effective_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_dunning_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"next_retry_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pause_entitlement_voids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pause_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"original_ends_at" date NOT NULL,
	"adjusted_ends_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pause_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" date NOT NULL,
	"ends_at" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"duration_days" integer NOT NULL,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"trial_days" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"next_billing_date" date,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"is_voided" boolean DEFAULT false NOT NULL,
	"voided_at" timestamp with time zone,
	"reason" text,
	"last_payment_intent_id" text,
	"last_payment_attempt_id" text,
	"payment_profile_id" text,
	"is_past_due" boolean DEFAULT false NOT NULL,
	"billing_retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_entitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"starts_at" date NOT NULL,
	"ends_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"is_current" boolean DEFAULT true NOT NULL,
	"source_batch_id" uuid,
	"closed_batch_id" uuid,
	"paused_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_type" "policy_rule_type" NOT NULL,
	"rule_value" jsonb NOT NULL,
	"tier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"priority_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiers_code_unique" UNIQUE("code"),
	CONSTRAINT "tiers_priority_level_unique" UNIQUE("priority_level")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_dunning_queue" ADD CONSTRAINT "membership_dunning_queue_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_entitlement_voids" ADD CONSTRAINT "pause_entitlement_voids_pause_id_pause_periods_id_fk" FOREIGN KEY ("pause_id") REFERENCES "public"."pause_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_entitlement_voids" ADD CONSTRAINT "pause_entitlement_voids_entitlement_id_subscription_entitlement_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."subscription_entitlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_source_batch_id_event_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."event_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_closed_batch_id_event_batches_id_fk" FOREIGN KEY ("closed_batch_id") REFERENCES "public"."event_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_policies" ADD CONSTRAINT "subscription_policies_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;