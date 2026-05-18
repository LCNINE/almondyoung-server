CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "cafe24_member_mappings" (
	"cafe24_member_id" varchar(256) PRIMARY KEY NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"email" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"external_claim_id" varchar(255),
	"raw_data" jsonb,
	"transformed_data" jsonb,
	"status" varchar(20) DEFAULT 'pending',
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) DEFAULT 'ChannelAdapter' NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"partition_key" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now(),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"failed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "migration_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" varchar(100) NOT NULL,
	"master_id" varchar(100) NOT NULL,
	"version_id" varchar(100),
	"error_type" varchar(50) NOT NULL,
	"error_message" text NOT NULL,
	"stack_trace" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"resolved" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "migration_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" varchar(100) NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" varchar(20) DEFAULT 'in_progress' NOT NULL,
	"total_masters" integer DEFAULT 0 NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"batch_size" integer DEFAULT 100 NOT NULL,
	"current_offset" integer DEFAULT 0 NOT NULL,
	"last_processed_master_id" varchar(100),
	"last_error" text,
	"error_stack_trace" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "migration_progress_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "pending_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" varchar(50) NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'pending_mapping' NOT NULL,
	"unmapped_items" jsonb NOT NULL,
	"raw_order_event" jsonb NOT NULL,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" timestamp,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pim_medusa_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pim_master_id" uuid NOT NULL,
	"pim_version_id" uuid,
	"pim_version" integer,
	"medusa_product_id" varchar(255),
	"medusa_handle" varchar(255),
	"sync_status" varchar(20) DEFAULT 'synced' NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"last_sync_action" varchar(20),
	"sync_error_count" integer DEFAULT 0 NOT NULL,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polling_change_hashes" (
	"source" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"hash" varchar(64) NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "polling_change_hashes_source_resource_type_resource_id_pk" PRIMARY KEY("source","resource_type","resource_id")
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"idempotency_key" varchar(255),
	"source" varchar(50) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"event_version" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'PROCESSED' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_histories" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"sync_type" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"total_count" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"error_details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sync_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" varchar(50) NOT NULL,
	"data_type" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"last_sync_at" timestamp,
	"last_event_count" integer DEFAULT 0,
	"total_syncs" integer DEFAULT 0,
	"successful_syncs" integer DEFAULT 0,
	"failed_syncs" integer DEFAULT 0,
	"avg_processing_time_ms" integer DEFAULT 0,
	"last_error_message" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wms_order_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sales_channel" varchar(50) NOT NULL,
	"channel_order_id" varchar(255) NOT NULL,
	"wms_order_id" uuid NOT NULL,
	"wms_status" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event"."outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "event"."event_resource_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"chain_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"action" varchar(50),
	"description" text,
	"service_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."role_scope_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" varchar(50),
	"description" text,
	"microservice_name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inbox_status_created" ON "inbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_pending_next_attempt" ON "inbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_partition_key" ON "inbox_events" USING btree ("partition_key");--> statement-breakpoint
CREATE INDEX "idx_migration_failures_session" ON "migration_failures" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_migration_failures_master" ON "migration_failures" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_migration_failures_resolved" ON "migration_failures" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "idx_migration_session" ON "migration_progress" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_migration_status" ON "migration_progress" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_migration_started" ON "migration_progress" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_pending_orders_status" ON "pending_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pending_orders_channel" ON "pending_orders" USING btree ("channel");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pending_orders_external" ON "pending_orders" USING btree ("channel","external_order_id");--> statement-breakpoint
CREATE INDEX "idx_pending_orders_created" ON "pending_orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pim_medusa_master" ON "pim_medusa_mappings" USING btree ("pim_master_id");--> statement-breakpoint
CREATE INDEX "idx_pim_medusa_product" ON "pim_medusa_mappings" USING btree ("medusa_product_id");--> statement-breakpoint
CREATE INDEX "idx_pim_medusa_handle" ON "pim_medusa_mappings" USING btree ("medusa_handle");--> statement-breakpoint
CREATE INDEX "idx_pim_medusa_sync_status" ON "pim_medusa_mappings" USING btree ("sync_status");--> statement-breakpoint
CREATE INDEX "idx_pim_medusa_last_synced" ON "pim_medusa_mappings" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "idx_polling_hashes_last_seen" ON "polling_change_hashes" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_processed_source_event" ON "processed_events" USING btree ("source","event_type","resource_id","event_version");--> statement-breakpoint
CREATE INDEX "idx_processed_status" ON "processed_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_processed_created" ON "processed_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sync_status_channel_data" ON "sync_statuses" USING btree ("channel_id","data_type");--> statement-breakpoint
CREATE INDEX "idx_sync_status_status" ON "sync_statuses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_status_last_sync" ON "sync_statuses" USING btree ("last_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wms_mapping_channel_order" ON "wms_order_mappings" USING btree ("sales_channel","channel_order_id");--> statement-breakpoint
CREATE INDEX "idx_wms_mapping_wms_id" ON "wms_order_mappings" USING btree ("wms_order_id");--> statement-breakpoint
CREATE INDEX "idx_wms_mapping_created" ON "wms_order_mappings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");