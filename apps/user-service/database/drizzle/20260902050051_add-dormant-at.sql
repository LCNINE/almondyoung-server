ALTER TABLE "users" ADD COLUMN "dormant_at" timestamp;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "partition_key" varchar(128);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_status_next_attempt_idx" ON "event"."outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_partition_created_idx" ON "event"."outbox_events" USING btree ("partition_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_outbox_topic_event_idempotency" ON "event"."outbox_events" USING btree ("topic","event_type","idempotency_key");