CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."question_category" AS ENUM('product', 'delivery', 'order', 'exchange', 'account', 'etc');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('active', 'answered', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."review_reward_policy_type" AS ENUM('TEXT', 'PHOTO');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('active', 'hidden', 'deleted');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_media" (
	"question_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "question_media_pkey" PRIMARY KEY("question_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"nickname" varchar(30) NOT NULL,
	"product_id" uuid,
	"category" "question_category",
	"sub_category" varchar(50),
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"status" "question_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction_type" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_pkey" PRIMARY KEY("target_type","target_id","user_id","reaction_type")
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_eligibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" varchar(255) NOT NULL,
	"order_id" varchar(255) NOT NULL,
	"order_line_id" varchar(255) NOT NULL,
	"eligible_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"consumed_by_review_id" uuid,
	"source_system" varchar(30) DEFAULT 'almondyoung' NOT NULL,
	"source_event_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_media" (
	"review_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_media_pkey" PRIMARY KEY("review_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "review_reward_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_type" "review_reward_policy_type" NOT NULL,
	"reward_amount" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"min_content_length" integer DEFAULT 10 NOT NULL,
	"min_media_count" integer DEFAULT 0 NOT NULL,
	"description" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"product_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"content" text NOT NULL,
	"status" "review_status" DEFAULT 'active' NOT NULL,
	"source_system" varchar(30) DEFAULT 'almondyoung' NOT NULL,
	"legacy_author_name" varchar(100),
	"legacy_member_id" varchar(100),
	"legacy_source_review_id" integer,
	"legacy_source_order_id" varchar(50),
	"legacy_imported_at" timestamp,
	"legacy_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event"."outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "event"."event_resource_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"chain_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"action" varchar(50),
	"description" text,
	"service_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."role_scope_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" varchar(50),
	"description" text,
	"microservice_name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_media" ADD CONSTRAINT "question_media_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD CONSTRAINT "review_eligibilities_consumed_by_review_id_reviews_id_fk" FOREIGN KEY ("consumed_by_review_id") REFERENCES "public"."reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_id_unique" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_media_question_order_unique" ON "question_media" USING btree ("question_id","order");--> statement-breakpoint
CREATE INDEX "question_media_question_id" ON "question_media" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "questions_product_id" ON "questions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "questions_user_id" ON "questions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "questions_created_at" ON "questions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "questions_status" ON "questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "questions_category" ON "questions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "reactions_target" ON "reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reactions_user" ON "reactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_comments_review_id_unique" ON "review_comments" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_eligibilities_source_unique" ON "review_eligibilities" USING btree ("source_system","source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_eligibilities_order_line_unique" ON "review_eligibilities" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "review_eligibilities_user_product" ON "review_eligibilities" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "review_eligibilities_order_id" ON "review_eligibilities" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "review_eligibilities_consumed_at" ON "review_eligibilities" USING btree ("consumed_at");--> statement-breakpoint
CREATE INDEX "review_eligibilities_expires_at" ON "review_eligibilities" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_media_review_order_unique" ON "review_media" USING btree ("review_id","order");--> statement-breakpoint
CREATE INDEX "review_media_review_id" ON "review_media" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_media_file_id" ON "review_media" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reward_policies_type_active_unique" ON "review_reward_policies" USING btree ("review_type") WHERE "review_reward_policies"."active" = true;--> statement-breakpoint
CREATE INDEX "review_reward_policies_active" ON "review_reward_policies" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_legacy_source_unique" ON "reviews" USING btree ("source_system","legacy_source_review_id");--> statement-breakpoint
CREATE INDEX "reviews_product_id" ON "reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "reviews_user_id" ON "reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reviews_created_at" ON "reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");