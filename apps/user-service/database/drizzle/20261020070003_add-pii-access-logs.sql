CREATE TABLE "pii_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"occurred_at" timestamp (3) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_login_id" varchar(30),
	"claimed_ip" varchar(45),
	"peer_ip" varchar(45),
	"forwarded_for" text,
	"user_agent" text,
	"request_id" varchar(100),
	"source_service" varchar(40) NOT NULL,
	"method" varchar(10) NOT NULL,
	"route" text NOT NULL,
	"action" varchar(10) NOT NULL,
	"subjects" jsonb NOT NULL,
	"subject_count" integer NOT NULL,
	"kinds" text[] NOT NULL,
	"query_keys" text[] NOT NULL,
	"reason" text,
	"recorded_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pii_access_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" varchar(40) NOT NULL,
	"range_from" timestamp (3) NOT NULL,
	"range_to" timestamp (3) NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_by_login_id" varchar(30),
	"reviewed_at" timestamp (3) DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pii_access_logs_event_id_idx" ON "pii_access_logs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "pii_access_logs_occurred_at_idx" ON "pii_access_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "pii_access_logs_actor_idx" ON "pii_access_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "pii_access_logs_subjects_idx" ON "pii_access_logs" USING gin ("subjects" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "pii_access_reviews_reviewed_at_idx" ON "pii_access_reviews" USING btree ("reviewed_at");