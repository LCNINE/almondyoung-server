ALTER TABLE "fact_order_items" ALTER COLUMN "order_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");
