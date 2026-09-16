CREATE TABLE "cron_runs" (
	"name" varchar(100) NOT NULL,
	"period_at" timestamp with time zone NOT NULL,
	"claimed_by" varchar(100) NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" varchar(20),
	CONSTRAINT "cron_runs_name_period_at_pk" PRIMARY KEY("name","period_at")
);
--> statement-breakpoint
ALTER TABLE "assistant_chat_sessions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_assistant_sessions_deleted_at" ON "assistant_chat_sessions" USING btree ("deleted_at");