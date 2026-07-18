CREATE TABLE "channel_dispatch_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbox_event_id" uuid NOT NULL,
	"dispatch_attempt_id" uuid,
	"shipment_id" uuid,
	"sales_order_id" uuid NOT NULL,
	"operation" varchar(30) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"provider_idempotency_key" varchar(255) NOT NULL,
	"request_snapshot" jsonb NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"result_snapshot" jsonb,
	"last_attempt_at" timestamp,
	"processing_started_at" timestamp,
	"lease_expires_at" timestamp,
	"provider_acknowledged_at" timestamp,
	"succeeded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_channel_dispatch_operation" CHECK ("channel_dispatch_operations"."operation" in ('dispatch', 'delivery', 'recall', 'cancel')),
	CONSTRAINT "chk_channel_dispatch_status" CHECK ("channel_dispatch_operations"."status" in ('pending', 'processing', 'provider_acknowledged', 'succeeded', 'failed', 'manual_adjustment_required')),
	CONSTRAINT "chk_channel_dispatch_attempts_nonnegative" CHECK ("channel_dispatch_operations"."attempts" >= 0),
	CONSTRAINT "chk_channel_dispatch_identity_shape" CHECK ((
		("channel_dispatch_operations"."operation" = 'cancel' and "channel_dispatch_operations"."dispatch_attempt_id" is null and "channel_dispatch_operations"."shipment_id" is null)
		or
		("channel_dispatch_operations"."operation" <> 'cancel' and "channel_dispatch_operations"."dispatch_attempt_id" is not null and "channel_dispatch_operations"."shipment_id" is not null)
	))
);
--> statement-breakpoint
ALTER TABLE "inbox_events" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "channel_dispatch_operations" ADD CONSTRAINT "channel_dispatch_operations_inbox_event_id_inbox_events_id_fk" FOREIGN KEY ("inbox_event_id") REFERENCES "public"."inbox_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_dispatch_attempt_order_operation" ON "channel_dispatch_operations" USING btree ("dispatch_attempt_id","sales_order_id","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_dispatch_inbox_order_operation" ON "channel_dispatch_operations" USING btree ("inbox_event_id","sales_order_id","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_dispatch_cancel_order" ON "channel_dispatch_operations" USING btree ("sales_order_id","operation") WHERE "channel_dispatch_operations"."operation" = 'cancel';--> statement-breakpoint
CREATE INDEX "idx_channel_dispatch_status_created" ON "channel_dispatch_operations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_channel_dispatch_status_lease" ON "channel_dispatch_operations" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "idx_channel_dispatch_attempt" ON "channel_dispatch_operations" USING btree ("dispatch_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inbox_event_idempotency" ON "inbox_events" USING btree ("event_type","idempotency_key") WHERE "inbox_events"."idempotency_key" is not null;
