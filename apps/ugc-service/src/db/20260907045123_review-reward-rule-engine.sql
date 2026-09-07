CREATE TYPE "public"."review_best_selection_status" AS ENUM('CANDIDATE', 'CONFIRMED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."review_reward_grant_status" AS ENUM('GRANTED', 'SKIPPED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."review_reward_kind" AS ENUM('NONE', 'POINT_FIXED', 'POINT_RATE', 'BADGE');--> statement-breakpoint
CREATE TYPE "public"."review_reward_trigger" AS ENUM('ON_REVIEW_CREATED', 'WEEKLY_BEST');--> statement-breakpoint
CREATE TABLE "review_best_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid,
	"rank" integer NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"status" "review_best_selection_status" DEFAULT 'CANDIDATE' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reward_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid,
	"trigger" "review_reward_trigger" NOT NULL,
	"reward_kind" "review_reward_kind" NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"status" "review_reward_grant_status" NOT NULL,
	"skip_reason" varchar(40),
	"selection_id" uuid,
	"revoked_at" timestamp,
	"revoke_reason" varchar(40),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reward_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"trigger" "review_reward_trigger" NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"stop_on_match" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"reward" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD COLUMN "order_line_amount" integer;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "partition_key" varchar(128);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "review_best_selections" ADD CONSTRAINT "review_best_selections_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_best_selections" ADD CONSTRAINT "review_best_selections_rule_id_review_reward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."review_reward_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reward_grants" ADD CONSTRAINT "review_reward_grants_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reward_grants" ADD CONSTRAINT "review_reward_grants_rule_id_review_reward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."review_reward_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_best_selections_period_review_unique" ON "review_best_selections" USING btree ("period_start","review_id");--> statement-breakpoint
CREATE INDEX "review_best_selections_period" ON "review_best_selections" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "review_best_selections_status" ON "review_best_selections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_best_selections_review" ON "review_best_selections" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reward_grants_review_trigger_unique" ON "review_reward_grants" USING btree ("review_id","trigger");--> statement-breakpoint
CREATE INDEX "review_reward_grants_user_created" ON "review_reward_grants" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "review_reward_grants_status_created" ON "review_reward_grants" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "review_reward_grants_rule" ON "review_reward_grants" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "review_reward_rules_trigger_active" ON "review_reward_rules" USING btree ("trigger","active");--> statement-breakpoint
CREATE INDEX "review_reward_rules_priority" ON "review_reward_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_active_product_rating" ON "reviews" USING btree ("product_id","rating") WHERE "reviews"."status" = 'active' AND "reviews"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_active_rating" ON "reviews" USING btree ("rating") WHERE "reviews"."status" = 'active' AND "reviews"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_status_next_attempt_idx" ON "event"."outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_partition_created_idx" ON "event"."outbox_events" USING btree ("partition_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_outbox_topic_event_idempotency" ON "event"."outbox_events" USING btree ("topic","event_type","idempotency_key");