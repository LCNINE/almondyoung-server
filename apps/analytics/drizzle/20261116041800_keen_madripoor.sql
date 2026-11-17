CREATE TABLE "external_revenue_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"recorded_by" varchar(255),
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_revenue_monthly" ADD COLUMN "original_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_revenue_monthly" ADD COLUMN "monthly_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_revenue_monthly" ADD COLUMN "duplicate_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_revenue_monthly" ADD COLUMN "settlement_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_revenue_monthly" ADD COLUMN "review_note" text DEFAULT '' NOT NULL;