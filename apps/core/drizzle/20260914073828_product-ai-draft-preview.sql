ALTER TABLE "product_ai_messages" ADD COLUMN "product_draft" jsonb;--> statement-breakpoint
ALTER TABLE "product_ai_sessions" ADD COLUMN "saved_product" jsonb;