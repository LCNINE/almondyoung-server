CREATE TABLE "batch_cms_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"payment_method_id" varchar(26) NOT NULL,
	"hms_member_id" varchar(64) NOT NULL,
	"hms_cust_id" varchar(64) DEFAULT 'default-cust' NOT NULL,
	"credit_limit" numeric(18, 2) NOT NULL,
	"approved_limit" numeric(18, 2) NOT NULL,
	"billing_cycle_day" integer NOT NULL,
	"hms_metadata" text,
	"terms_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bnpl_account" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"payment_method_id" varchar(26) NOT NULL,
	"credit_limit" numeric(18, 2) NOT NULL,
	"approved_limit" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"billing_cycle_day" integer NOT NULL,
	"terms_url" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_activation_event" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"payment_method_id" varchar(26) NOT NULL,
	"bnpl_account_id" varchar(21) NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"bnpl_account_id" varchar(21) NOT NULL,
	"payment_session_id" varchar(26) NOT NULL,
	"transaction_type" text NOT NULL,
	"status" text NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"hms_member_id" varchar(64),
	"method_type" text DEFAULT 'CARD' NOT NULL,
	"pg_token" varchar(128) NOT NULL,
	"billing_key" varchar(128) NOT NULL,
	"masked_card_number" varchar(32) NOT NULL,
	"last_four_digits" varchar(4),
	"card_brand" varchar(32),
	"card_type" varchar(32),
	"issuer_name" varchar(64),
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_method_hms_member_id_unique" UNIQUE("hms_member_id")
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"intent_id" varchar(26) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"redirect_url" text NOT NULL,
	"cancel_url" text NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" text
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
CREATE TABLE "payment_attempts" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"intent_id" varchar(26) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"instrument_kind" varchar(16),
	"instrument_ref" text,
	"profile_id" varchar(26),
	"amount" numeric(19, 4) NOT NULL,
	"status" varchar(255) NOT NULL,
	"actor" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	"event_context" text NOT NULL,
	"transaction_id" varchar(255),
	"approval_number" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"session_id" varchar(26) NOT NULL,
	"method_id" varchar(26),
	"amount" numeric(19, 4) NOT NULL,
	"status" varchar(255) NOT NULL,
	"actor" varchar(255) NOT NULL,
	"provider" varchar(32),
	"instrument_kind" varchar(16),
	"instrument_ref" text,
	"profile_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text,
	"event_context" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"type" varchar(32) DEFAULT 'ORDER' NOT NULL,
	"allowed_providers" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	"refunded_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
	"authorized_at" timestamp with time zone,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_locks" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"payment_session_id" varchar(26) NOT NULL,
	"lock_token" varchar(128) NOT NULL,
	"device_fingerprint" varchar(64),
	"user_agent" text,
	"ip_address" varchar(45),
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_locks_lock_token_unique" UNIQUE("lock_token")
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"method_type" text NOT NULL,
	"method_name" varchar(64) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payment_purpose" text DEFAULT 'PURCHASE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_method_id_type" UNIQUE("id","method_type")
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"intent_id" varchar(26) NOT NULL,
	"attempt_id" varchar(26) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"status" varchar(255) NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" varchar(64),
	"metadata" text,
	"refund_account_id" varchar(26)
);
--> statement-breakpoint
CREATE TABLE "payment_session_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"payment_session_id" varchar(26) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"event_data" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sessions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"type" varchar(32) DEFAULT 'ORDER' NOT NULL,
	"allowed_providers" text,
	"metadata" text,
	"refunded_amount" numeric(19, 4) DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"point_id" varchar(26) NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"related_event_id" varchar(26),
	"reason" varchar(255),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "refund_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"payment_event_id" varchar(26) NOT NULL,
	"refund_account_id" varchar(26),
	"amount" numeric(19, 4) NOT NULL,
	"status" varchar(255) NOT NULL,
	"reason" text,
	"completed_by" varchar(64),
	"completed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "settlement_batch" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"bnpl_account_id" varchar(21) NOT NULL,
	"batch_number" varchar(50) NOT NULL,
	"total_amount" numeric(19, 4) DEFAULT 0 NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"pg_transaction_id" varchar(255),
	"batch_period_start" timestamp with time zone NOT NULL,
	"batch_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_batch_item" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"batch_id" varchar(26) NOT NULL,
	"bnpl_event_id" varchar(26) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_process_event" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"batch_id" varchar(26) NOT NULL,
	"batch_item_id" varchar(26),
	"event_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"payment_event_id" varchar(26),
	"error_message" text,
	"metadata" text,
	"actor" varchar(255) DEFAULT 'SCHEDULER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_refund_accounts" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
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
CREATE TABLE "v_bnpl_collection_event" (
	"event_id" varchar(26) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(26) NOT NULL,
	"invoice_item_id" varchar(26),
	"event_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"payment_event_id" varchar(26),
	"error_message" text,
	"metadata" text,
	"actor" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v_bnpl_invoice" (
	"invoice_id" varchar(26) PRIMARY KEY NOT NULL,
	"bnpl_account_id" varchar(21) NOT NULL,
	"total_amount" numeric(19, 4) NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" varchar(20) NOT NULL,
	"pg_transaction_id" varchar(255),
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v_bnpl_invoice_item" (
	"item_id" varchar(26) PRIMARY KEY NOT NULL,
	"invoice_id" varchar(26) NOT NULL,
	"usage_id" varchar(26) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batch_cms_method" ADD CONSTRAINT "batch_cms_method_id_payment_method_id_fk" FOREIGN KEY ("id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_cms_method" ADD CONSTRAINT "batch_cms_method_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_account" ADD CONSTRAINT "bnpl_account_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_activation_event" ADD CONSTRAINT "bnpl_activation_event_payment_method_id_payment_method_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_activation_event" ADD CONSTRAINT "bnpl_activation_event_bnpl_account_id_bnpl_account_id_fk" FOREIGN KEY ("bnpl_account_id") REFERENCES "public"."bnpl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_events" ADD CONSTRAINT "bnpl_events_bnpl_account_id_bnpl_account_id_fk" FOREIGN KEY ("bnpl_account_id") REFERENCES "public"."bnpl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_method" ADD CONSTRAINT "fk_card_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_session_id_payment_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."payment_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_method_id_payment_method_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_method"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_locks" ADD CONSTRAINT "payment_locks_payment_session_id_payment_sessions_id_fk" FOREIGN KEY ("payment_session_id") REFERENCES "public"."payment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_refund_account_id_user_refund_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "public"."user_refund_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_session_events" ADD CONSTRAINT "payment_session_events_payment_session_id_payment_sessions_id_fk" FOREIGN KEY ("payment_session_id") REFERENCES "public"."payment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_events" ADD CONSTRAINT "point_events_point_id_points_id_fk" FOREIGN KEY ("point_id") REFERENCES "public"."points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_payment_event_id_payment_events_id_fk" FOREIGN KEY ("payment_event_id") REFERENCES "public"."payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_refund_account_id_user_refund_accounts_id_fk" FOREIGN KEY ("refund_account_id") REFERENCES "public"."user_refund_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch" ADD CONSTRAINT "settlement_batch_bnpl_account_id_bnpl_account_id_fk" FOREIGN KEY ("bnpl_account_id") REFERENCES "public"."bnpl_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_batch_id_settlement_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_batch_item" ADD CONSTRAINT "settlement_batch_item_bnpl_event_id_bnpl_events_id_fk" FOREIGN KEY ("bnpl_event_id") REFERENCES "public"."bnpl_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_process_event" ADD CONSTRAINT "settlement_process_event_batch_id_settlement_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."settlement_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_process_event" ADD CONSTRAINT "settlement_process_event_batch_item_id_settlement_batch_item_id_fk" FOREIGN KEY ("batch_item_id") REFERENCES "public"."settlement_batch_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_hms_member_unique" ON "batch_cms_method" USING btree ("hms_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bnpl_account_user_unique" ON "bnpl_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bnpl_activation_payment_method" ON "bnpl_activation_event" USING btree ("payment_method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_billing_key_unique" ON "card_method" USING btree ("billing_key");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_user_id" ON "idempotency_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_status" ON "idempotency_keys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_idempotency_keys_user_status" ON "idempotency_keys" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_payment_events_method_id" ON "payment_events" USING btree ("method_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_status" ON "payment_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_events_created_at" ON "payment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_events_session_id" ON "payment_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_session_created" ON "payment_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_active_payment_lock" ON "payment_locks" USING btree ("payment_session_id") WHERE "payment_locks"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_payment_locks_expires_at" ON "payment_locks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_payment_locks_status" ON "payment_locks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_locks_token_unique" ON "payment_locks" USING btree ("lock_token");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_default_unique" ON "payment_method" USING btree ("user_id") WHERE "payment_method"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_payment_session_events_session_id" ON "payment_session_events" USING btree ("payment_session_id");--> statement-breakpoint
CREATE INDEX "idx_payment_session_events_occurred_at" ON "payment_session_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_payment_session_events_event_type" ON "payment_session_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_payment_sessions_status" ON "payment_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_sessions_user_id" ON "payment_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payment_sessions_expires_at" ON "payment_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_payment_sessions_user_created" ON "payment_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_sessions_status_updated" ON "payment_sessions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_default_refund_account" ON "user_refund_accounts" USING btree ("user_id") WHERE "user_refund_accounts"."is_default" = true;