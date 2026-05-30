CREATE TABLE "cs_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"priority" varchar(32) DEFAULT 'normal' NOT NULL,
	"reason_code" varchar(96),
	"subject" varchar(255) NOT NULL,
	"description" text,
	"customer_id" uuid,
	"customer_name" varchar(255),
	"customer_email" varchar(255),
	"customer_phone" varchar(64),
	"assigned_to" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_cs_cases_status" ON "cs_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cs_cases_reason_code" ON "cs_cases" USING btree ("reason_code");--> statement-breakpoint
CREATE INDEX "idx_cs_cases_customer_id" ON "cs_cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_cs_cases_created_at" ON "cs_cases" USING btree ("created_at");