ALTER TABLE "order_collection_failures" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_collection_failures" ADD COLUMN "failed_stage" varchar(30);--> statement-breakpoint
ALTER TABLE "order_collection_failures" ADD COLUMN "last_error" text;