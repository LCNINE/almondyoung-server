CREATE TABLE "order_collection_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" varchar(50) NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"reason" varchar(100) NOT NULL,
	"affected_line_ids" jsonb NOT NULL,
	"raw_order" jsonb NOT NULL,
	"source_updated_at" timestamp NOT NULL,
	"status" varchar(30) DEFAULT 'quarantined' NOT NULL,
	"replayed_at" timestamp,
	"replayed_wms_order_id" uuid,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_order_collection_failure" ON "order_collection_failures" USING btree ("channel","external_order_id","reason");--> statement-breakpoint
CREATE INDEX "idx_order_collection_failures_status" ON "order_collection_failures" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_order_collection_failures_channel" ON "order_collection_failures" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "idx_order_collection_failures_source_updated" ON "order_collection_failures" USING btree ("source_updated_at");