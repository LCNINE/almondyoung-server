CREATE TYPE "public"."product_bulk_image_source_kind" AS ENUM('file_id', 'file_name');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_image_status" AS ENUM('resolved', 'awaiting_upload');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_image_usage" AS ENUM('main', 'description');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_item_kind" AS ENUM('create', 'update');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_item_publish_status" AS ENUM('idle', 'pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_item_status" AS ENUM('pending', 'invalid', 'drafted', 'excluded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_bulk_session_phase" AS ENUM('uploaded', 'validating', 'review', 'awaiting_images', 'drafting', 'drafted', 'publishing', 'published', 'canceled', 'failed');--> statement-breakpoint
CREATE TABLE "product_bulk_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"image_key" varchar(100) NOT NULL,
	"usage" "product_bulk_image_usage" NOT NULL,
	"source_kind" "product_bulk_image_source_kind" NOT NULL,
	"source_value" text NOT NULL,
	"file_id" uuid,
	"status" "product_bulk_image_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_bulk_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"row_key" varchar(100) NOT NULL,
	"kind" "product_bulk_item_kind" NOT NULL,
	"master_id" uuid,
	"base_version_id" uuid,
	"base_snapshot" jsonb,
	"input" jsonb NOT NULL,
	"payload" jsonb,
	"status" "product_bulk_item_status" DEFAULT 'pending' NOT NULL,
	"conflict" jsonb,
	"conflict_decision" jsonb,
	"draft_version_id" uuid,
	"publish_status" "product_bulk_item_publish_status" DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"publish_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_bulk_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"export_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"source_file_id" uuid NOT NULL,
	"phase" "product_bulk_session_phase" DEFAULT 'uploaded' NOT NULL,
	"phase_error" text,
	"lease_until" timestamp,
	"lease_token" uuid,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"cancel_requested_at" timestamp,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_form_export_items" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "product_bulk_images" ADD CONSTRAINT "product_bulk_images_session_id_product_bulk_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."product_bulk_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bulk_items" ADD CONSTRAINT "product_bulk_items_session_id_product_bulk_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."product_bulk_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bulk_sessions" ADD CONSTRAINT "product_bulk_sessions_export_id_product_form_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."product_form_exports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bulk_images_session_key_usage" ON "product_bulk_images" USING btree ("session_id","image_key","usage");--> statement-breakpoint
CREATE INDEX "idx_bulk_images_session_status" ON "product_bulk_images" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bulk_items_session_row_key" ON "product_bulk_items" USING btree ("session_id","row_key");--> statement-breakpoint
CREATE INDEX "idx_bulk_items_session_status" ON "product_bulk_items" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "idx_bulk_sessions_claim" ON "product_bulk_sessions" USING btree ("phase","lease_until");--> statement-breakpoint
CREATE INDEX "idx_bulk_sessions_uploaded_by" ON "product_bulk_sessions" USING btree ("uploaded_by");