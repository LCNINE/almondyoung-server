ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
CREATE INDEX "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");