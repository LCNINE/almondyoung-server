CREATE TABLE "sms_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"daily_limit" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "sms_device_id" varchar(64);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "partition_key" varchar(128);--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sms_device_sent" ON "notifications" USING btree ("sms_device_id","sent_at");--> statement-breakpoint
CREATE INDEX "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");--> statement-breakpoint
CREATE INDEX "outbox_status_next_attempt_idx" ON "event"."outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_partition_created_idx" ON "event"."outbox_events" USING btree ("partition_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_event_outbox_topic_event_idempotency" ON "event"."outbox_events" USING btree ("topic","event_type","idempotency_key");