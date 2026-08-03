ALTER TYPE "public"."product_import_job_status" ADD VALUE 'canceled';--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "cancel_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "invalid_count" integer;