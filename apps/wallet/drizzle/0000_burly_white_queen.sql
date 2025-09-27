CREATE TYPE "public"."bnpl_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_type" AS ENUM('ORDER', 'BNPL_CAPTURE', 'MEMBERSHIP_FEE');--> statement-breakpoint
CREATE TYPE "public"."payment_profile_status" AS ENUM('PENDING', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('TOSS', 'KAKAOPAY', 'HMS_CARD', 'HMS_BNPL', 'POINTS');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('SUBSCRIPTION', 'PURCHASE', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."payment_session_status" AS ENUM('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."point_action" AS ENUM('EARN', 'EARN_CANCEL', 'REDEEM', 'REDEEM_CANCEL');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "bnpl_account" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"payment_profile_id" varchar(36) NOT NULL,
	"credit_limit" bigint NOT NULL,
	"approved_limit" bigint NOT NULL,
	"status" "bnpl_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_collection_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(26) NOT NULL,
	"invoice_item_id" varchar(26),
	"event_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"payment_event_id" varchar(26),
	"error_message" text,
	"metadata" text,
	"actor" varchar(255) DEFAULT 'SCHEDULER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"bnpl_account_id" varchar(36) NOT NULL,
	"payment_session_id" varchar(36) NOT NULL,
	"transaction_type" text NOT NULL,
	"status" "transaction_status" NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_invoice_items" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(36) NOT NULL,
	"bnpl_event_id" varchar(36) NOT NULL,
	"amount" bigint NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_invoices" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"bnpl_account_id" varchar(36) NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"pg_transaction_id" varchar(255),
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"intent_id" varchar(30) NOT NULL,
	"redirect_url" text NOT NULL,
	"return_url" text NOT NULL,
	"cancel_url" text NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"metadata" text DEFAULT null,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"cms_batch_profile_id" varchar(36) NOT NULL,
	"agreement_key" varchar(36),
	"agreement_kind" varchar(8),
	"status" varchar(16) NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_batch_profiles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"member_id" varchar(20) NOT NULL,
	"cms_status" varchar(16) NOT NULL,
	"payment_company" varchar(3),
	"payer_name" varchar(64),
	"phone_mask" varchar(20),
	"billing_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_batch_profiles_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "cms_card_profiles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"member_id" varchar(20) NOT NULL,
	"cms_status" varchar(16) NOT NULL,
	"payment_company" varchar(3),
	"card_last4" varchar(4),
	"card_brand" varchar(32),
	"payer_name" varchar(64),
	"phone_mask" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_card_profiles_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"request_path" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_code" integer,
	"response_body" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overdue_accounts" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"overdue_count" integer DEFAULT 1 NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"mall_id" varchar(36) NOT NULL,
	"member_id" varchar(36) NOT NULL,
	"name" varchar(100) NOT NULL,
	"referral_code" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"intent_id" varchar(36) NOT NULL,
	"profile_id" varchar(36),
	"instrument_type" varchar(16) DEFAULT 'PROFILE' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "transaction_status" NOT NULL,
	"actor" text DEFAULT 'USER' NOT NULL,
	"event_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	"transaction_id" varchar(255),
	"approval_number" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_session_status" DEFAULT 'PENDING' NOT NULL,
	"type" "payment_intent_type" DEFAULT 'ORDER' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"authorized_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_profiles" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"status" "payment_profile_status" DEFAULT 'PENDING' NOT NULL,
	"name" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"intent_id" varchar(36) NOT NULL,
	"attempt_id" varchar(36) NOT NULL,
	"amount" bigint NOT NULL,
	"status" "refund_status" NOT NULL,
	"reason" text,
	"completed_at" timestamp with time zone,
	"completed_by" varchar(64),
	"metadata" jsonb,
	"refund_account_id" varchar(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_event_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"point_event_id" integer NOT NULL,
	"partner_id" integer NOT NULL,
	"event_type" "point_action" NOT NULL,
	"amount" integer NOT NULL,
	"earned_event_detail_id" integer,
	"original_event_detail_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner_id" integer NOT NULL,
	"event_type" "point_action" NOT NULL,
	"amount" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawal_available_at" timestamp with time zone,
	"reason" text,
	"memo" text,
	"order_id" varchar(100),
	"original_event_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"mall_id" varchar(36) NOT NULL,
	"member_id" varchar(36) NOT NULL,
	"request_id" integer NOT NULL,
	"rewarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"mall_id" varchar(36) NOT NULL,
	"member_id" varchar(36) NOT NULL,
	"partner_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_refund_accounts" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"bank_code" varchar(32) NOT NULL,
	"bank_name" varchar(64) NOT NULL,
	"account_number" varchar(64) NOT NULL,
	"account_holder_name" varchar(128) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bnpl_account" ADD CONSTRAINT "bnpl_account_payment_profile_id_payment_profiles_id_fk" FOREIGN KEY ("payment_profile_id") REFERENCES "public"."payment_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_collection_events" ADD CONSTRAINT "bnpl_collection_events_invoice_id_bnpl_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."bnpl_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_collection_events" ADD CONSTRAINT "bnpl_collection_events_invoice_item_id_bnpl_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."bnpl_invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_events" ADD CONSTRAINT "bnpl_events_bnpl_account_id_bnpl_account_id_fk" FOREIGN KEY ("bnpl_account_id") REFERENCES "public"."bnpl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_invoice_items" ADD CONSTRAINT "bnpl_invoice_items_invoice_id_bnpl_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."bnpl_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_invoice_items" ADD CONSTRAINT "bnpl_invoice_items_bnpl_event_id_bnpl_events_id_fk" FOREIGN KEY ("bnpl_event_id") REFERENCES "public"."bnpl_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_invoices" ADD CONSTRAINT "bnpl_invoices_bnpl_account_id_bnpl_account_id_fk" FOREIGN KEY ("bnpl_account_id") REFERENCES "public"."bnpl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_cms_batch_profile_id_cms_batch_profiles_id_fk" FOREIGN KEY ("cms_batch_profile_id") REFERENCES "public"."cms_batch_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_batch_profiles" ADD CONSTRAINT "cms_batch_profiles_id_payment_profiles_id_fk" FOREIGN KEY ("id") REFERENCES "public"."payment_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_card_profiles" ADD CONSTRAINT "cms_card_profiles_id_payment_profiles_id_fk" FOREIGN KEY ("id") REFERENCES "public"."payment_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_refund_account_id_user_refund_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "public"."user_refund_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_point_event_id_point_events_id_fk" FOREIGN KEY ("point_event_id") REFERENCES "public"."point_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_earned_event_detail_id_point_event_details_id_fk" FOREIGN KEY ("earned_event_detail_id") REFERENCES "public"."point_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_original_event_detail_id_point_event_details_id_fk" FOREIGN KEY ("original_event_detail_id") REFERENCES "public"."point_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_original_event_id_point_events_id_fk" FOREIGN KEY ("original_event_id") REFERENCES "public"."point_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bnpl_account_user_unique" ON "bnpl_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_intent_id" ON "checkout_sessions" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_status" ON "checkout_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_created_at" ON "checkout_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_expires_at" ON "checkout_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_consents_payment_profile" ON "consents" USING btree ("cms_batch_profile_id");--> statement-breakpoint
CREATE INDEX "idx_consents_status" ON "consents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cms_card_member" ON "cms_card_profiles" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_cms_card_status" ON "cms_card_profiles" USING btree ("cms_status");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_user_id" ON "idempotency_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_status" ON "idempotency_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_user_status" ON "idempotency_keys" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_partners_mall" ON "partners" USING btree ("mall_id");--> statement-breakpoint
CREATE INDEX "idx_partners_member" ON "partners" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_partners_referral_code" ON "partners" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "idx_payment_attempts_intent_created" ON "payment_attempts" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_customer_id" ON "payment_intents" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_status" ON "payment_intents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_type" ON "payment_intents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_payment_profiles_user" ON "payment_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payment_profiles_kind" ON "payment_profiles" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_payment_refunds_intent_id" ON "payment_refunds" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_payment_refunds_attempt_id" ON "payment_refunds" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "idx_payment_refunds_status" ON "payment_refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_event" ON "point_event_details" USING btree ("point_event_id");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_partner" ON "point_event_details" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_earned" ON "point_event_details" USING btree ("earned_event_detail_id");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_original" ON "point_event_details" USING btree ("original_event_detail_id");--> statement-breakpoint
CREATE INDEX "idx_point_events_partner" ON "point_events" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_point_events_type" ON "point_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_point_events_expires" ON "point_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_point_events_original" ON "point_events" USING btree ("original_event_id");--> statement-breakpoint
CREATE INDEX "idx_referral_rewards_member" ON "referral_rewards" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_referral_rewards_mall" ON "referral_rewards" USING btree ("mall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_referral_rewards_unique" ON "referral_rewards" USING btree ("mall_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_member" ON "referrals" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_partner" ON "referrals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "idx_referrals_mall" ON "referrals" USING btree ("mall_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_default_refund_account" ON "user_refund_accounts" USING btree ("user_id") WHERE "user_refund_accounts"."is_default" = true;