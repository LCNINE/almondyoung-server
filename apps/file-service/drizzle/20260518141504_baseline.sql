CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "file_contexts" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"allow_public" boolean DEFAULT false NOT NULL,
	"allow_private" boolean DEFAULT true NOT NULL,
	"allowed_mime_types" jsonb,
	"max_file_size" integer NOT NULL,
	"path_prefix" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid NOT NULL,
	"service_type" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"file_path" text NOT NULL,
	"url" text NOT NULL,
	"storage_provider" varchar(20) DEFAULT 's3' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"context_id" varchar(50) NOT NULL,
	"related_type" varchar(50),
	"related_id" uuid,
	"metadata" jsonb,
	"uploaded_by" uuid NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"activated_at" timestamp
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
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_context_id_file_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."file_contexts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_file_refs_upload" ON "file_references" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "idx_file_refs_entity" ON "file_references" USING btree ("service_type","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_file_reference" ON "file_references" USING btree ("upload_id","service_type","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_status" ON "uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_uploads_context_id" ON "uploads" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_related" ON "uploads" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_uploaded_by" ON "uploads" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "idx_uploads_created_at" ON "uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");