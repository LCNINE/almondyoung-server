CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'OPEN', 'MANDATE_PENDING', 'ATTEMPTING', 'PAST_DUE', 'PAID', 'UNCOLLECTIBLE', 'MANDATE_REJECTED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."subscription_billing_method_role" AS ENUM('PRIMARY', 'BACKUP');--> statement-breakpoint
CREATE TYPE "public"."subscription_billing_method_status" AS ENUM('ACTIVE', 'PENDING_MANDATE', 'REVOKED', 'FAILED');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_type" varchar(64) NOT NULL,
	"subscriber_ref" varchar(255) NOT NULL,
	"billing_method_id" uuid NOT NULL,
	"amount_due" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"retry_interval_hours" integer DEFAULT 72 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_due_non_negative" CHECK ("invoices"."amount_due" >= 0),
	CONSTRAINT "invoices_period_valid" CHECK ("invoices"."period_end" >= "invoices"."period_start"),
	CONSTRAINT "invoices_attempt_count_non_negative" CHECK ("invoices"."attempt_count" >= 0),
	CONSTRAINT "invoices_max_attempts_positive" CHECK ("invoices"."max_attempts" > 0),
	CONSTRAINT "invoices_retry_interval_hours_positive" CHECK ("invoices"."retry_interval_hours" > 0),
	CONSTRAINT "invoices_terminal_finalized_consistency" CHECK (("invoices"."status" IN ('PAID', 'UNCOLLECTIBLE', 'MANDATE_REJECTED', 'VOID')) = ("invoices"."finalized_at" IS NOT NULL)),
	CONSTRAINT "invoices_next_attempt_status_consistency" CHECK ((
        ("invoices"."status" IN ('OPEN', 'MANDATE_PENDING', 'PAST_DUE') AND "invoices"."next_attempt_at" IS NOT NULL)
        OR ("invoices"."status" IN ('PAID', 'UNCOLLECTIBLE', 'MANDATE_REJECTED', 'VOID') AND "invoices"."next_attempt_at" IS NULL)
        OR "invoices"."status" IN ('DRAFT', 'ATTEMPTING')
      ))
);
--> statement-breakpoint
CREATE TABLE "subscription_billing_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_type" varchar(64) NOT NULL,
	"subscriber_ref" varchar(255) NOT NULL,
	"billing_method_id" uuid NOT NULL,
	"role" "subscription_billing_method_role" DEFAULT 'PRIMARY' NOT NULL,
	"status" "subscription_billing_method_status" DEFAULT 'PENDING_MANDATE' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_method_id_billing_methods_id_fk" FOREIGN KEY ("billing_method_id") REFERENCES "public"."billing_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_billing_methods" ADD CONSTRAINT "subscription_billing_methods_billing_method_id_billing_methods_id_fk" FOREIGN KEY ("billing_method_id") REFERENCES "public"."billing_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_idempotency_key" ON "invoices" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_invoices_subscriber" ON "invoices" USING btree ("subscriber_type","subscriber_ref");--> statement-breakpoint
CREATE INDEX "idx_invoices_status_next_attempt_at" ON "invoices" USING btree ("status","next_attempt_at") WHERE "invoices"."next_attempt_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_billing_methods_active_primary" ON "subscription_billing_methods" USING btree ("subscriber_type","subscriber_ref") WHERE "subscription_billing_methods"."role" = 'PRIMARY' AND "subscription_billing_methods"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_billing_methods_pending_primary" ON "subscription_billing_methods" USING btree ("subscriber_type","subscriber_ref") WHERE "subscription_billing_methods"."role" = 'PRIMARY' AND "subscription_billing_methods"."status" = 'PENDING_MANDATE';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_billing_methods_live_method" ON "subscription_billing_methods" USING btree ("subscriber_type","subscriber_ref","billing_method_id") WHERE "subscription_billing_methods"."status" IN ('ACTIVE', 'PENDING_MANDATE');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_billing_methods_live_backup_priority" ON "subscription_billing_methods" USING btree ("subscriber_type","subscriber_ref","priority") WHERE "subscription_billing_methods"."role" = 'BACKUP' AND "subscription_billing_methods"."status" IN ('ACTIVE', 'PENDING_MANDATE');--> statement-breakpoint
CREATE INDEX "idx_subscription_billing_methods_subscriber" ON "subscription_billing_methods" USING btree ("subscriber_type","subscriber_ref");--> statement-breakpoint
CREATE INDEX "idx_subscription_billing_methods_billing_method_id" ON "subscription_billing_methods" USING btree ("billing_method_id");--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payment_intents_invoice_id" ON "payment_intents" USING btree ("invoice_id") WHERE "payment_intents"."invoice_id" IS NOT NULL;