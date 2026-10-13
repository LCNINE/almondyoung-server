DROP INDEX "almond_templates_product_size_title_unique";--> statement-breakpoint
ALTER TABLE "almond_templates" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "almond_templates" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "almond_templates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "almond_templates_product_size_title_unique" ON "almond_templates" USING btree ("product_id","width_mm","height_mm","title") WHERE "almond_templates"."deleted_at" is null;