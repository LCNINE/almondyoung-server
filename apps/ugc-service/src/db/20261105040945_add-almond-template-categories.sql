CREATE TABLE "almond_template_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(40) NOT NULL,
	"description" varchar(80),
	"image_file_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "almond_template_categories_sort" ON "almond_template_categories" USING btree ("sort_order");