CREATE TYPE "public"."product_form_export_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "product_form_export_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"export_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"row_key" varchar(100) NOT NULL,
	"pricing_editable" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_form_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_master_ids" uuid[] NOT NULL,
	"status" "product_form_export_status" DEFAULT 'queued' NOT NULL,
	"file_id" uuid,
	"product_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"lease_until" timestamp,
	"lease_token" uuid,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_form_export_items" ADD CONSTRAINT "product_form_export_items_export_id_product_form_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."product_form_exports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_form_export_items_master" ON "product_form_export_items" USING btree ("export_id","master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_form_export_items_row_key" ON "product_form_export_items" USING btree ("export_id","row_key");--> statement-breakpoint
CREATE INDEX "idx_form_exports_claim" ON "product_form_exports" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "idx_form_exports_expires" ON "product_form_exports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_form_exports_requested_by" ON "product_form_exports" USING btree ("requested_by");