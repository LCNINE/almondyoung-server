CREATE TABLE "event"."dead_letters" (
	"id" serial PRIMARY KEY NOT NULL,
	"consumer_group" varchar(200) NOT NULL,
	"handler" varchar(200) NOT NULL,
	"topic" varchar(100) NOT NULL,
	"sequence_key" varchar(200),
	"message_id" varchar(200) NOT NULL,
	"event_type" varchar(100),
	"envelope" jsonb NOT NULL,
	"kafka_partition" integer NOT NULL,
	"kafka_offset" varchar(40) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_name" varchar(200),
	"error_message" text,
	"redrive_count" integer DEFAULT 0 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event"."failure_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target_kind" varchar(20) NOT NULL,
	"target_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"actor" varchar(100),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dead_letters_group_handler_message" ON "event"."dead_letters" USING btree ("consumer_group","handler","message_id");--> statement-breakpoint
CREATE INDEX "dead_letters_unresolved_sequence_idx" ON "event"."dead_letters" USING btree ("consumer_group","topic","sequence_key","id") WHERE status in ('failed', 'held');--> statement-breakpoint
CREATE INDEX "failure_actions_target_idx" ON "event"."failure_actions" USING btree ("target_kind","target_id");