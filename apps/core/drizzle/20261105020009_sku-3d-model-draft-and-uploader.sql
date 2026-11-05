ALTER TABLE "sku_3d_models" DROP CONSTRAINT "ck_sku_3d_models_status";--> statement-breakpoint
ALTER TABLE "sku_3d_models" ADD COLUMN "uploaded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sku_3d_models" ADD COLUMN "uploaded_by_label" varchar(255);--> statement-breakpoint
ALTER TABLE "sku_3d_models" ADD CONSTRAINT "ck_sku_3d_models_status" CHECK ("sku_3d_models"."status" IN ('draft', 'approved', 'needs_revision', 'needs_more_photos', 'failed'));