ALTER TABLE "billing_events" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_billing_events_payment_intent" ON "billing_events" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");