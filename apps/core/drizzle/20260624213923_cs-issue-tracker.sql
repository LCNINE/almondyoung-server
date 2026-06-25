CREATE TABLE "cs_case_comment_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cs_case_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"file_id" varchar(255) NOT NULL,
	"file_name" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cs_case_comment_mentions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cs_comment_mention" UNIQUE("comment_id","mentioned_user_id")
);
--> statement-breakpoint
CREATE TABLE "cs_case_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cs_case_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cs_case_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cs_case_id" uuid NOT NULL,
	"type" varchar(48) NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cs_case_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cs_case_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cs_case_label" UNIQUE("cs_case_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "cs_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(96) NOT NULL,
	"color" varchar(16) DEFAULT '#888888' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cs_labels_name" UNIQUE("name")
);
--> statement-breakpoint
DROP INDEX "idx_cs_cases_reason_code";--> statement-breakpoint
ALTER TABLE "cs_cases" ADD COLUMN "source_channel" varchar(32) DEFAULT 'kakao' NOT NULL;--> statement-breakpoint
ALTER TABLE "cs_cases" ADD COLUMN "external_thread_ref" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_cs_attachment_case_id" ON "cs_case_comment_attachments" USING btree ("cs_case_id");--> statement-breakpoint
CREATE INDEX "idx_cs_attachment_comment_id" ON "cs_case_comment_attachments" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "idx_cs_mention_user" ON "cs_case_comment_mentions" USING btree ("mentioned_user_id");--> statement-breakpoint
CREATE INDEX "idx_cs_case_comments_case_id" ON "cs_case_comments" USING btree ("cs_case_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_cs_case_events_case_id" ON "cs_case_events" USING btree ("cs_case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_cs_case_labels_case_id" ON "cs_case_labels" USING btree ("cs_case_id");--> statement-breakpoint
CREATE INDEX "idx_cs_cases_assigned_to" ON "cs_cases" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_cs_cases_source_channel" ON "cs_cases" USING btree ("source_channel");--> statement-breakpoint
UPDATE "cs_cases"
SET "status" = 'closed',
	"closed_at" = COALESCE("closed_at", "resolved_at", "updated_at")
WHERE "status" = 'resolved';--> statement-breakpoint
ALTER TABLE "cs_cases" DROP COLUMN "reason_code";--> statement-breakpoint
ALTER TABLE "cs_cases" DROP COLUMN "customer_email";--> statement-breakpoint
ALTER TABLE "cs_cases" DROP COLUMN "customer_phone";--> statement-breakpoint
ALTER TABLE "cs_cases" DROP COLUMN "resolved_at";
