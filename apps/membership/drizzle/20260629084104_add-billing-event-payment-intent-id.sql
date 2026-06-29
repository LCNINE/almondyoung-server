ALTER TABLE "billing_events" ADD COLUMN IF NOT EXISTS "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_events_intent_result" ON "billing_events" USING btree ("contract_id","payment_intent_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");
