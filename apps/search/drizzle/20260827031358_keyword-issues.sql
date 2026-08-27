CREATE TYPE "public"."keyword_issue_status" AS ENUM('new', 'dev', 'md', 'in_progress', 'resolved', 'ignored');--> statement-breakpoint
CREATE TABLE "search_keyword_issues" (
	"keyword_norm" text PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"status" "keyword_issue_status" DEFAULT 'new' NOT NULL,
	"assignee_id" text,
	"assignee_name" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "search_keyword_issues_status_idx" ON "search_keyword_issues" USING btree ("status");