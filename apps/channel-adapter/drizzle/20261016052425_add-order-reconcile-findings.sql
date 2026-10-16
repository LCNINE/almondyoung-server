CREATE TABLE "order_reconcile_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" varchar(50) NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"display_order_no" varchar(64),
	"kind" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"handling" varchar(10) NOT NULL,
	"human_reason" varchar(30),
	"core_status" varchar(30),
	"channel_created_at" timestamp with time zone NOT NULL,
	"mode" varchar(10) NOT NULL,
	"last_result" varchar(200),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" varchar(100),
	"close_memo" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_order_reconcile_findings_open" ON "order_reconcile_findings" USING btree ("channel","external_order_id","kind") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "order_reconcile_findings_status_handling_idx" ON "order_reconcile_findings" USING btree ("status","handling");