CREATE TABLE "sku_field_capture_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"worker_label" varchar(255) NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_field_captures" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"barcode_status" varchar(20) NOT NULL,
	"scanned_barcode" varchar(64),
	"barcode_conflict_sku_id" uuid,
	"all_faces_confirmed" boolean NOT NULL,
	"last_worker_id" uuid NOT NULL,
	"last_worker_label" varchar(255) NOT NULL,
	"first_completed_at" timestamp with time zone NOT NULL,
	"last_completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_sku_field_captures_barcode_status" CHECK ("sku_field_captures"."barcode_status" IN ('scanned','no_manufacturer','none'))
);
--> statement-breakpoint
CREATE TABLE "sku_reference_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"taken_by_id" uuid NOT NULL,
	"taken_by_label" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_shelf_positions" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"position_code" varchar(64) NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "package_width_mm" integer;--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "package_length_mm" integer;--> statement-breakpoint
ALTER TABLE "skus" ADD COLUMN "package_height_mm" integer;--> statement-breakpoint
ALTER TABLE "sku_field_capture_events" ADD CONSTRAINT "sku_field_capture_events_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_field_captures" ADD CONSTRAINT "sku_field_captures_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_field_captures" ADD CONSTRAINT "sku_field_captures_barcode_conflict_sku_id_skus_id_fk" FOREIGN KEY ("barcode_conflict_sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_reference_photos" ADD CONSTRAINT "sku_reference_photos_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_shelf_positions" ADD CONSTRAINT "sku_shelf_positions_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sku_field_capture_events_worker_completed" ON "sku_field_capture_events" USING btree ("worker_id","completed_at");--> statement-breakpoint
CREATE INDEX "idx_sku_reference_photos_sku_sort" ON "sku_reference_photos" USING btree ("sku_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_sku_shelf_positions_code" ON "sku_shelf_positions" USING btree ("position_code");