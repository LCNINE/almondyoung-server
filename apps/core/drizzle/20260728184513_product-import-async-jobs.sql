CREATE TYPE "public"."product_import_item_publish_status" AS ENUM('pending', 'published', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."product_import_job_status" AS ENUM('idle', 'queued', 'running', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."product_import_item_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "publish_status" "product_import_item_publish_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "product_import_items" ADD COLUMN "published_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "commit_status" "product_import_job_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "publish_status" "product_import_job_status" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "commit_error" text;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "published_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "publish_failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_import_items_session_status" ON "product_import_items" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_commit_claim" ON "product_import_sessions" USING btree ("commit_status","lease_until");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_publish_claim" ON "product_import_sessions" USING btree ("publish_status","lease_until");