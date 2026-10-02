CREATE TYPE "public"."almond_template_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "almond_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"title" varchar(80) NOT NULL,
	"industry" varchar(40),
	"purpose" varchar(40),
	"colors" jsonb NOT NULL,
	"design" jsonb NOT NULL,
	"thumbnail_svg" text NOT NULL,
	"status" "almond_template_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "almond_templates_product_size_title_unique" ON "almond_templates" USING btree ("product_id","width_mm","height_mm","title");--> statement-breakpoint
CREATE INDEX "almond_templates_status_updated" ON "almond_templates" USING btree ("status","updated_at");