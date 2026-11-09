CREATE TABLE "medusa_reservation_projection_versions" (
	"sales_order_id" varchar PRIMARY KEY NOT NULL,
	"applied_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medusa_reservation_reconcile_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"fixes" integer DEFAULT 0 NOT NULL,
	"fix_failures" integer DEFAULT 0 NOT NULL,
	"deferred" integer DEFAULT 0 NOT NULL,
	"unknown" integer DEFAULT 0 NOT NULL,
	"oldest_unknown_at" timestamp with time zone,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"close_reason" text,
	"forced_by" text,
	CONSTRAINT "medusa_reservation_reconcile_runs_status_check" CHECK ("medusa_reservation_reconcile_runs"."status" in ('applied','halted','skipped','running'))
);
--> statement-breakpoint
CREATE TABLE "reservation_projection_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"cutover_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE INDEX "medusa_reservation_reconcile_runs_started_idx" ON "medusa_reservation_reconcile_runs" USING btree ("started_at");