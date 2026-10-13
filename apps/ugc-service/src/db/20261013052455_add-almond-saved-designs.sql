CREATE TABLE "almond_saved_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"title" varchar(80) NOT NULL,
	"design" jsonb NOT NULL,
	"thumbnail_svg" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "almond_saved_designs_user_updated" ON "almond_saved_designs" USING btree ("user_id","updated_at");