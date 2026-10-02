CREATE TABLE "almond_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" varchar(36) NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"template_id" uuid,
	"design" jsonb NOT NULL,
	"front_svg" text NOT NULL,
	"back_svg" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "almond_designs_user_created" ON "almond_designs" USING btree ("user_id","created_at");