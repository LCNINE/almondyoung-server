ALTER TABLE "product_ai_sessions" ADD COLUMN "reply_status" varchar(20) DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_ai_sessions" ADD COLUMN "last_user_message_id" uuid;--> statement-breakpoint
ALTER TABLE "product_ai_sessions" ADD COLUMN "reply_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "product_ai_sessions" ADD COLUMN "reply_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_ai_sessions" ADD COLUMN "reply_error" text;