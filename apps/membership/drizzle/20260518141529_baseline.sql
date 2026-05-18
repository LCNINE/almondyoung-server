CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."event_publish_status" AS ENUM('PENDING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pause_status" AS ENUM('ACTIVE', 'ENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."policy_rule_type" AS ENUM('MAX_PAUSES_PER_YEAR', 'MIN_PAUSE_DURATION_DAYS', 'MAX_PAUSE_DURATION_DAYS', 'PAUSE_COOLDOWN_DAYS', 'PAUSE_BLACKOUT_PERIODS', 'PLAN_CHANGE_COOLDOWN_DAYS', 'ALLOWED_PLAN_CHANGES', 'DOWNGRADE_RESTRICTIONS', 'UPGRADE_BENEFITS', 'TIER_SPECIFIC_LIMITS', 'VIP_USER_BENEFITS', 'NEW_USER_GRACE_PERIOD', 'PROMOTIONAL_PERIODS', 'SEASONAL_RESTRICTIONS', 'SPECIAL_EVENT_RULES', 'TRIAL_REFUND_ENABLED', 'RESUBSCRIPTION_REFUND_WINDOW_HOURS', 'BENEFIT_USAGE_AFFECTS_REFUND', 'PARTIAL_REFUND_CALCULATION_METHOD', 'REFUND_PROCESSING_DAYS', 'TRIAL_DURATION_DAYS', 'TRIAL_REUSE_PREVENTION', 'TRIAL_COOLDOWN_DAYS');--> statement-breakpoint
CREATE TYPE "public"."subscription_change_type" AS ENUM('UPGRADE', 'DOWNGRADE', 'RENEWAL', 'INITIAL');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'PENDING_CHANGE');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"attempt_no" integer,
	"amount" integer,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"display_text" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"admin_id" text,
	"effective_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_cycle_benefits" (
	"user_id" varchar NOT NULL,
	"cycle_start_date" date NOT NULL,
	"cycle_end_date" date NOT NULL,
	"total_discount_amount" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"subscription_id" varchar NOT NULL,
	"cycle_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_cycle_benefits_user_id_cycle_start_date_pk" PRIMARY KEY("user_id","cycle_start_date")
);
--> statement-breakpoint
CREATE TABLE "membership_discount_events" (
	"order_id" varchar(100) PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"discount_amount" integer NOT NULL,
	"tier_id" uuid NOT NULL,
	"cycle_start_date" date NOT NULL,
	"subscription_id" varchar NOT NULL,
	"order_date" timestamp with time zone NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_dunning_queue_contract_id_unique" UNIQUE("contract_id")
);
--> statement-breakpoint
CREATE TABLE "pause_event_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pause_event_id" uuid NOT NULL,
	"user_id" varchar NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"adjustment_days" integer NOT NULL,
	"original_detail_id" uuid,
	"starts_at" date NOT NULL,
	"ends_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pause_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"entitlement_id" uuid,
	"event_type" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"previous_event_id" uuid,
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
CREATE TABLE "subscription_contract_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"user_id" varchar NOT NULL,
	"metadata" jsonb NOT NULL,
	"batch_id" uuid,
	"caused_by" text NOT NULL,
	"caused_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_date" date NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason_code" text,
	"refund_requested" boolean DEFAULT false NOT NULL,
	"refund_requested_at" timestamp with time zone,
	"eligible_refund_amount" integer,
	"refund_completed" boolean DEFAULT false NOT NULL,
	"refund_completed_at" timestamp with time zone,
	"wallet_reference_id" text,
	"last_event_id" integer,
	"recurring_cancelled_at" timestamp with time zone,
	"recurring_cancellation_reason_code" text,
	"auto_renewal" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_entitlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
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
CREATE TABLE "welcome_membership_eligibility" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"has_purchased" boolean DEFAULT false NOT NULL,
	"purchase_source" text DEFAULT 'cafe24' NOT NULL,
	"first_order_id" text,
	"purchased_at" timestamp with time zone,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event"."outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "event"."event_resource_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"chain_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"action" varchar(50),
	"description" text,
	"service_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."role_scope_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" varchar(50),
	"description" text,
	"microservice_name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_dunning_queue" ADD CONSTRAINT "membership_dunning_queue_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_event_details" ADD CONSTRAINT "pause_event_details_pause_event_id_pause_events_id_fk" FOREIGN KEY ("pause_event_id") REFERENCES "public"."pause_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_event_details" ADD CONSTRAINT "pause_event_details_entitlement_id_subscription_entitlement_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."subscription_entitlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_event_details" ADD CONSTRAINT "pause_event_details_original_detail_id_pause_event_details_id_fk" FOREIGN KEY ("original_detail_id") REFERENCES "public"."pause_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_events" ADD CONSTRAINT "pause_events_entitlement_id_subscription_entitlement_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."subscription_entitlement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pause_events" ADD CONSTRAINT "pause_events_previous_event_id_pause_events_id_fk" FOREIGN KEY ("previous_event_id") REFERENCES "public"."pause_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contract_events" ADD CONSTRAINT "subscription_contract_events_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contract_events" ADD CONSTRAINT "subscription_contract_events_batch_id_event_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."event_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_source_batch_id_event_batches_id_fk" FOREIGN KEY ("source_batch_id") REFERENCES "public"."event_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_entitlement" ADD CONSTRAINT "subscription_entitlement_closed_batch_id_event_batches_id_fk" FOREIGN KEY ("closed_batch_id") REFERENCES "public"."event_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_policies" ADD CONSTRAINT "subscription_policies_tier_id_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_billing_events_contract" ON "billing_events" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_cycle_subscription" ON "membership_cycle_benefits" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_cycle_end_date" ON "membership_cycle_benefits" USING btree ("cycle_end_date");--> statement-breakpoint
CREATE INDEX "idx_events_user_cycle" ON "membership_discount_events" USING btree ("user_id","cycle_start_date");--> statement-breakpoint
CREATE INDEX "idx_events_subscription" ON "membership_discount_events" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_events_cancelled" ON "membership_discount_events" USING btree ("is_cancelled");--> statement-breakpoint
CREATE INDEX "idx_pause_event_details_user" ON "pause_event_details" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pause_event_details_entitlement" ON "pause_event_details" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "idx_pause_event_details_original" ON "pause_event_details" USING btree ("original_detail_id");--> statement-breakpoint
CREATE INDEX "idx_pause_event_details_pause_event" ON "pause_event_details" USING btree ("pause_event_id");--> statement-breakpoint
CREATE INDEX "idx_pause_events_user" ON "pause_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pause_events_entitlement" ON "pause_events" USING btree ("entitlement_id");--> statement-breakpoint
CREATE INDEX "idx_contract_events_contract_id" ON "subscription_contract_events" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "idx_contract_events_user_id" ON "subscription_contract_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_contract_events_type" ON "subscription_contract_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_subscription_billing_date" ON "subscription_contracts" USING btree ("billing_date");--> statement-breakpoint
CREATE INDEX "idx_wm_eligibility_has_purchased" ON "welcome_membership_eligibility" USING btree ("has_purchased");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");