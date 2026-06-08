CREATE TABLE "payment_method_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(32) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(2) NOT NULL,
	"name" varchar(128) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_lowercase" CHECK ("regions"."code" = lower("regions"."code"))
);
--> statement-breakpoint
ALTER TABLE "event"."outbox_events" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "region_payment_methods" ADD CONSTRAINT "region_payment_methods_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_payment_methods" ADD CONSTRAINT "region_payment_methods_catalog_id_payment_method_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."payment_method_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_method_catalog_code" ON "payment_method_catalog" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_region_payment_methods_region_catalog" ON "region_payment_methods" USING btree ("region_id","catalog_id");--> statement-breakpoint
CREATE INDEX "idx_region_payment_methods_region" ON "region_payment_methods" USING btree ("region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_regions_code" ON "regions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "outbox_processing_started_idx" ON "event"."outbox_events" USING btree ("status","processing_started_at");