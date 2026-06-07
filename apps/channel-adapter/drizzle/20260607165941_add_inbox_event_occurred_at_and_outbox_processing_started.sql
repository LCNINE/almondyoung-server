ALTER TABLE "inbox_events" ADD COLUMN "event_occurred_at" timestamp;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_inbox_aggregate_event_occurred" ON "inbox_events" USING btree ("aggregate_id","event_occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");