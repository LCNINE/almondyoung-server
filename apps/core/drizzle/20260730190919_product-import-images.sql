CREATE TYPE "public"."product_import_image_status" AS ENUM('pending', 'probed', 'uploaded', 'probe_failed', 'fetch_failed');--> statement-breakpoint
CREATE TYPE "public"."product_import_image_usage" AS ENUM('main', 'description');--> statement-breakpoint
CREATE TABLE "product_import_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"image_key" varchar(255) NOT NULL,
	"usage" "product_import_image_usage" NOT NULL,
	"source_url" text NOT NULL,
	"status" "product_import_image_status" DEFAULT 'pending' NOT NULL,
	"file_id" uuid,
	"mime_type" varchar(255),
	"size_bytes" bigint,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "image_status" "product_import_job_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_import_sessions" ADD COLUMN "image_error" text;--> statement-breakpoint
ALTER TABLE "product_import_images" ADD CONSTRAINT "product_import_images_session_id_product_import_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."product_import_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_import_images_session_key_usage" ON "product_import_images" USING btree ("session_id","image_key","usage");--> statement-breakpoint
CREATE INDEX "idx_import_images_session_status" ON "product_import_images" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_image_claim" ON "product_import_sessions" USING btree ("image_status","lease_until");