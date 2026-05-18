CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."billing_agreement_status" AS ENUM('ACTIVE', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."billing_method_status" AS ENUM('ACTIVE', 'REVOKED', 'DELETED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."charge_operation" AS ENUM('AUTHORIZE', 'CAPTURE', 'CANCEL', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'REQUIRES_ACTION');--> statement-breakpoint
CREATE TYPE "public"."checkout_session_status" AS ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."cms_member_status" AS ENUM('PENDING', 'REGISTERED', 'FAILED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."cms_withdrawal_status" AS ENUM('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."intent_purpose" AS ENUM('PURCHASE', 'SUBSCRIPTION', 'REPAYMENT', 'PAYOUT');--> statement-breakpoint
CREATE TYPE "public"."wallet_outbox_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_item_discount_kind" AS ENUM('ITEM_PER_UNIT', 'ITEM_FLAT');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_item_type" AS ENUM('PRODUCT', 'SUBSCRIPTION', 'SHIPPING_FEE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_order_discount_kind" AS ENUM('ORDER');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('CREATED', 'PROCESSING', 'REQUIRES_ACTION', 'AUTHORIZED', 'CAPTURED', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PENDING_SETTLEMENT', 'PARTIALLY_CAPTURED');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('POINTS', 'CARD', 'BANK_TRANSFER', 'BNPL', 'TOSS', 'NICEPAY', 'TOSS_BILLING', 'NICEPAY_BILLING', 'CMS_BATCH');--> statement-breakpoint
CREATE TYPE "public"."payment_state_entity_type" AS ENUM('INTENT', 'CHARGE', 'REFUND');--> statement-breakpoint
CREATE TYPE "public"."payment_state_trigger_type" AS ENUM('SYSTEM', 'USER', 'ADMIN', 'WEBHOOK', 'COMMAND');--> statement-breakpoint
CREATE TYPE "public"."point_event_type" AS ENUM('EARN', 'REDEEM', 'EARN_CANCEL', 'REDEEM_CANCEL');--> statement-breakpoint
CREATE TYPE "public"."point_hold_status" AS ENUM('AUTHORIZED', 'CAPTURED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."provider_webhook_receipt_status" AS ENUM('RECEIVED', 'PROCESSED', 'IGNORED_DUPLICATE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "billing_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"billing_method_id" uuid NOT NULL,
	"subscriber_ref" varchar(255) NOT NULL,
	"subscriber_type" varchar(64) NOT NULL,
	"status" "billing_agreement_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"provider_type" varchar(64) NOT NULL,
	"billing_key" text,
	"customer_key" varchar(128),
	"cms_member_id" varchar(20),
	"display_name" varchar(255),
	"method" jsonb,
	"status" "billing_method_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"operation" charge_operation NOT NULL,
	"status" charge_status NOT NULL,
	"provider_transaction_id" varchar(128),
	"provider_idempotency_key" varchar(255) NOT NULL,
	"error_code" varchar(128),
	"error_message" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_amount_positive" CHECK ("charges"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"purpose" "intent_purpose" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success_url" text NOT NULL,
	"cancel_url" text NOT NULL,
	"allow_composite" boolean DEFAULT false NOT NULL,
	"intent_id" uuid,
	"status" "checkout_session_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cms_member_id" varchar(20) NOT NULL,
	"agreement_key" varchar(64),
	"file_type" varchar(16) NOT NULL,
	"file_extension" varchar(8) NOT NULL,
	"status" varchar(32) NOT NULL,
	"result_code" varchar(16),
	"result_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_method_id" uuid NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"cms_member_id" varchar(20) NOT NULL,
	"payment_company" varchar(3) NOT NULL,
	"payer_name" varchar(15) NOT NULL,
	"payer_number" varchar(10) NOT NULL,
	"status" "cms_member_status" DEFAULT 'PENDING' NOT NULL,
	"result_code" varchar(16),
	"result_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cms_withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cms_member_id" varchar(20) NOT NULL,
	"transaction_id" varchar(30) NOT NULL,
	"charge_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"payment_date" varchar(8) NOT NULL,
	"amount" integer NOT NULL,
	"status" "cms_withdrawal_status" DEFAULT 'REQUESTED' NOT NULL,
	"result_code" varchar(16),
	"result_message" text,
	"actual_amount" integer,
	"fee" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(64) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"partition_key" varchar(128) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "wallet_outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"last_error_message" text,
	"dead_lettered_at" timestamp with time zone,
	"dead_letter_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intent_item_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"discount_ref_id" varchar(128),
	"kind" "payment_intent_item_discount_kind" NOT NULL,
	"amount" integer NOT NULL,
	"name" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intent_item_discounts_amount_positive" CHECK ("payment_intent_item_discounts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_intent_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"line_id" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"item_type" "payment_intent_item_type",
	"item_ref_id" varchar(128),
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"base_amount" integer NOT NULL,
	"item_discount_per_unit_total" integer DEFAULT 0 NOT NULL,
	"item_discount_flat_total" integer DEFAULT 0 NOT NULL,
	"payable_amount" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intent_items_unit_price_non_negative" CHECK ("payment_intent_items"."unit_price" >= 0),
	CONSTRAINT "payment_intent_items_quantity_positive" CHECK ("payment_intent_items"."quantity" > 0),
	CONSTRAINT "payment_intent_items_base_amount_non_negative" CHECK ("payment_intent_items"."base_amount" >= 0),
	CONSTRAINT "payment_intent_items_discount_per_unit_non_negative" CHECK ("payment_intent_items"."item_discount_per_unit_total" >= 0),
	CONSTRAINT "payment_intent_items_discount_flat_non_negative" CHECK ("payment_intent_items"."item_discount_flat_total" >= 0),
	CONSTRAINT "payment_intent_items_payable_amount_non_negative" CHECK ("payment_intent_items"."payable_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_intent_order_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"discount_ref_id" varchar(128),
	"kind" "payment_intent_order_discount_kind" DEFAULT 'ORDER' NOT NULL,
	"amount" integer NOT NULL,
	"name" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intent_order_discounts_amount_positive" CHECK ("payment_intent_order_discounts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payable_amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_intent_status" NOT NULL,
	"purpose" "intent_purpose" DEFAULT 'PURCHASE' NOT NULL,
	"user_id" varchar(128),
	"payment_method_id" uuid,
	"client_secret" varchar(64) NOT NULL,
	"return_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_payable_amount_non_negative" CHECK ("payment_intents"."payable_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"display_name" varchar(255),
	"is_reusable" boolean DEFAULT true NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "payment_state_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"reason_code" varchar(128),
	"reason_message" text,
	"triggered_by_type" "payment_state_trigger_type" NOT NULL,
	"triggered_by_id" varchar(128),
	"correlation_id" varchar(128) NOT NULL,
	"causation_id" varchar(128),
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_event_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"point_event_id" uuid NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"event_type" "point_event_type" NOT NULL,
	"amount" integer NOT NULL,
	"earned_event_detail_id" uuid,
	"original_event_detail_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_event_details_amount_non_zero" CHECK ("point_event_details"."amount" <> 0),
	CONSTRAINT "point_event_details_type_amount_consistency" CHECK ((
        ("point_event_details"."event_type" in ('EARN', 'REDEEM_CANCEL') and "point_event_details"."amount" > 0)
        or
        ("point_event_details"."event_type" in ('REDEEM', 'EARN_CANCEL') and "point_event_details"."amount" < 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "point_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"event_type" "point_event_type" NOT NULL,
	"amount" integer NOT NULL,
	"original_event_id" uuid,
	"intent_id" uuid,
	"leg_id" uuid,
	"attempt_id" uuid,
	"provider_idempotency_key" varchar(255) NOT NULL,
	"provider_transaction_id" varchar(128),
	"reason_code" varchar(128),
	"reason_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_events_amount_non_zero" CHECK ("point_events"."amount" <> 0),
	CONSTRAINT "point_events_type_amount_consistency" CHECK ((
        ("point_events"."event_type" in ('EARN', 'REDEEM_CANCEL') and "point_events"."amount" > 0)
        or
        ("point_events"."event_type" in ('REDEEM', 'EARN_CANCEL') and "point_events"."amount" < 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "point_hold_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hold_id" uuid NOT NULL,
	"earned_event_detail_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_hold_details_amount_positive" CHECK ("point_hold_details"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "point_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"intent_id" uuid NOT NULL,
	"leg_id" uuid NOT NULL,
	"authorize_attempt_id" uuid NOT NULL,
	"authorize_provider_idempotency_key" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"status" "point_hold_status" NOT NULL,
	"captured_event_id" uuid,
	"capture_attempt_id" uuid,
	"capture_provider_idempotency_key" varchar(255),
	"cancel_attempt_id" uuid,
	"cancel_provider_idempotency_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_holds_amount_positive" CHECK ("point_holds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type" varchar(64) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"payload_hash" varchar(128),
	"status" "provider_webhook_receipt_status" NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "refund_status" NOT NULL,
	"reason_code" varchar(128),
	"reason_message" text,
	"provider_refund_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount" > 0)
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
ALTER TABLE "billing_agreements" ADD CONSTRAINT "billing_agreements_billing_method_id_billing_methods_id_fk" FOREIGN KEY ("billing_method_id") REFERENCES "public"."billing_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_members" ADD CONSTRAINT "cms_members_billing_method_id_billing_methods_id_fk" FOREIGN KEY ("billing_method_id") REFERENCES "public"."billing_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_withdrawals" ADD CONSTRAINT "cms_withdrawals_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cms_withdrawals" ADD CONSTRAINT "cms_withdrawals_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_item_discounts" ADD CONSTRAINT "payment_intent_item_discounts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_item_discounts" ADD CONSTRAINT "payment_intent_item_discounts_item_id_payment_intent_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."payment_intent_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_items" ADD CONSTRAINT "payment_intent_items_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_order_discounts" ADD CONSTRAINT "payment_intent_order_discounts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_point_event_id_point_events_id_fk" FOREIGN KEY ("point_event_id") REFERENCES "public"."point_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_earned_event_detail_id_point_event_details_id_fk" FOREIGN KEY ("earned_event_detail_id") REFERENCES "public"."point_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_details" ADD CONSTRAINT "point_event_details_original_event_detail_id_point_event_details_id_fk" FOREIGN KEY ("original_event_detail_id") REFERENCES "public"."point_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_hold_details" ADD CONSTRAINT "point_hold_details_hold_id_point_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."point_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_hold_details" ADD CONSTRAINT "point_hold_details_earned_event_detail_id_point_event_details_id_fk" FOREIGN KEY ("earned_event_detail_id") REFERENCES "public"."point_event_details"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_holds" ADD CONSTRAINT "point_holds_captured_event_id_point_events_id_fk" FOREIGN KEY ("captured_event_id") REFERENCES "public"."point_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_billing_agreements_subscriber" ON "billing_agreements" USING btree ("subscriber_type","subscriber_ref");--> statement-breakpoint
CREATE INDEX "idx_billing_agreements_user_id" ON "billing_agreements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_billing_agreements_billing_method_id" ON "billing_agreements" USING btree ("billing_method_id");--> statement-breakpoint
CREATE INDEX "idx_billing_methods_user_id" ON "billing_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_billing_methods_user_provider_status" ON "billing_methods" USING btree ("user_id","provider_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_charges_provider_idempotency_key" ON "charges" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_charges_active_intent_operation" ON "charges" USING btree ("intent_id","operation") WHERE "charges"."status" in ('CREATED', 'PENDING', 'REQUIRES_ACTION');--> statement-breakpoint
CREATE INDEX "idx_charges_intent_created_at" ON "charges" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_charges_status_created_at" ON "charges" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_user_status" ON "checkout_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_status_expires_at" ON "checkout_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_cms_agreements_cms_member_id" ON "cms_agreements" USING btree ("cms_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cms_members_cms_member_id" ON "cms_members" USING btree ("cms_member_id");--> statement-breakpoint
CREATE INDEX "idx_cms_members_billing_method_id" ON "cms_members" USING btree ("billing_method_id");--> statement-breakpoint
CREATE INDEX "idx_cms_members_user_id" ON "cms_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cms_members_status" ON "cms_members" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cms_withdrawals_transaction_id" ON "cms_withdrawals" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_cms_withdrawals_intent_id" ON "cms_withdrawals" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_cms_withdrawals_status_payment_date" ON "cms_withdrawals" USING btree ("status","payment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbox_events_message_id" ON "outbox_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_outbox_events_status_next_attempt_at" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_outbox_events_partition_created_at" ON "outbox_events" USING btree ("partition_key","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_intent_item_discounts_intent" ON "payment_intent_item_discounts" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_payment_intent_item_discounts_item" ON "payment_intent_item_discounts" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intent_items_intent_line" ON "payment_intent_items" USING btree ("intent_id","line_id");--> statement-breakpoint
CREATE INDEX "idx_payment_intent_items_intent_created_at" ON "payment_intent_items" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_intent_order_discounts_intent" ON "payment_intent_order_discounts" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intents_client_secret" ON "payment_intents" USING btree ("client_secret");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_status_expires_at" ON "payment_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_user_created_at" ON "payment_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_methods_user_id" ON "payment_methods" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_payment_methods_user_type" ON "payment_methods" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "idx_payment_state_transitions_entity" ON "payment_state_transitions" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_payment_state_transitions_correlation" ON "payment_state_transitions" USING btree ("correlation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_user_earned_created_at" ON "point_event_details" USING btree ("user_id","earned_event_detail_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_point_event_details_point_event_created_at" ON "point_event_details" USING btree ("point_event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_events_provider_idempotency_key" ON "point_events" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_point_events_user_created_at" ON "point_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_point_events_intent_leg_created_at" ON "point_events" USING btree ("intent_id","leg_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_hold_details_hold_earned_detail" ON "point_hold_details" USING btree ("hold_id","earned_event_detail_id");--> statement-breakpoint
CREATE INDEX "idx_point_hold_details_earned_event_detail_id" ON "point_hold_details" USING btree ("earned_event_detail_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_holds_authorize_provider_idempotency_key" ON "point_holds" USING btree ("authorize_provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_holds_capture_provider_idempotency_key" ON "point_holds" USING btree ("capture_provider_idempotency_key") WHERE "point_holds"."capture_provider_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_holds_cancel_provider_idempotency_key" ON "point_holds" USING btree ("cancel_provider_idempotency_key") WHERE "point_holds"."cancel_provider_idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_point_holds_leg_authorized" ON "point_holds" USING btree ("leg_id") WHERE "point_holds"."status" = 'AUTHORIZED';--> statement-breakpoint
CREATE INDEX "idx_point_holds_user_status_created_at" ON "point_holds" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_point_holds_leg_created_at" ON "point_holds" USING btree ("leg_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_webhook_receipts_provider_event" ON "provider_webhook_receipts" USING btree ("provider_type","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_provider_webhook_receipts_status_received_at" ON "provider_webhook_receipts" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "idx_refunds_charge_id" ON "refunds" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_intent_id" ON "refunds" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_status_created_at" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");