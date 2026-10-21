ALTER TABLE "sku_field_capture_events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sku_field_captures" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sku_field_captures" ADD COLUMN "deleted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sku_field_captures" ADD COLUMN "deleted_by_label" varchar(255);