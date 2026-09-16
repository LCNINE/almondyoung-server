CREATE TABLE "demo_run_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"order_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"processing_started_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_demo_run_items_sequence" CHECK ("demo_run_items"."sequence" > 0),
	CONSTRAINT "chk_demo_run_items_attempts" CHECK ("demo_run_items"."attempts" >= 0),
	CONSTRAINT "chk_demo_run_items_status" CHECK ("demo_run_items"."status" in ('pending', 'processing', 'enqueued', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "demo_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"scenario" varchar(40) NOT NULL,
	"status" varchar(30) DEFAULT 'processing' NOT NULL,
	"requested_count" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chk_demo_runs_scenario" CHECK ("demo_runs"."scenario" in ('happy_path', 'inventory_shortage')),
	CONSTRAINT "chk_demo_runs_status" CHECK ("demo_runs"."status" in ('processing', 'completed', 'partial_failure', 'failed')),
	CONSTRAINT "chk_demo_runs_count" CHECK ("demo_runs"."requested_count" between 1 and 50),
	CONSTRAINT "chk_demo_runs_quantity" CHECK ("demo_runs"."quantity" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "demo_run_items" ADD CONSTRAINT "demo_run_items_run_id_demo_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."demo_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demo_run_items_run_sequence" ON "demo_run_items" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demo_run_items_external_order" ON "demo_run_items" USING btree ("external_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demo_run_items_order_id" ON "demo_run_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_demo_run_items_claim" ON "demo_run_items" USING btree ("run_id","status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_demo_runs_request_id" ON "demo_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_demo_runs_created_at" ON "demo_runs" USING btree ("created_at");