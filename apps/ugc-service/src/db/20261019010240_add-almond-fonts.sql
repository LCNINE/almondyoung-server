CREATE TABLE "almond_fonts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(60) NOT NULL,
	"file_id" uuid NOT NULL,
	"format" varchar(8) NOT NULL,
	"created_by" uuid NOT NULL,
	"license_confirmed_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "almond_fonts_file_unique" ON "almond_fonts" USING btree ("file_id");