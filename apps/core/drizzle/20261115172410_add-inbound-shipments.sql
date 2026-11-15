CREATE TYPE "public"."inbound_shipment_box_disposition" AS ENUM('stock', 'forward');--> statement-breakpoint
CREATE TYPE "public"."inbound_shipment_box_origin" AS ENUM('list', 'added');--> statement-breakpoint
CREATE TYPE "public"."inbound_shipment_box_status" AS ENUM('open', 'received');--> statement-breakpoint
CREATE TYPE "public"."inbound_shipment_line_kind" AS ENUM('sku', 'free', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."inbound_shipment_line_resolution" AS ENUM('barcode', 'manual');--> statement-breakpoint
CREATE TYPE "public"."inbound_shipment_status" AS ENUM('draft', 'expected', 'receiving', 'closed', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."inbound_receipt_source" ADD VALUE 'inbound_shipment';--> statement-breakpoint
CREATE TABLE "inbound_shipment_box_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"box_id" uuid NOT NULL,
	"line_id" uuid,
	"sku_id" uuid,
	"counted_qty" integer NOT NULL,
	"receipt_line_id" uuid,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_shipment_box_counts_receipt_line_id_unique" UNIQUE("receipt_line_id"),
	CONSTRAINT "ck_inbound_shipment_box_counts_qty" CHECK ("inbound_shipment_box_counts"."counted_qty" >= 0),
	CONSTRAINT "ck_inbound_shipment_box_counts_sku" CHECK ("inbound_shipment_box_counts"."line_id" IS NOT NULL OR "inbound_shipment_box_counts"."sku_id" IS NOT NULL),
	CONSTRAINT "ck_inbound_shipment_box_counts_unplanned_qty" CHECK ("inbound_shipment_box_counts"."line_id" IS NOT NULL OR "inbound_shipment_box_counts"."counted_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "inbound_shipment_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"label" varchar(32) NOT NULL,
	"sort_key" integer NOT NULL,
	"origin" "inbound_shipment_box_origin" NOT NULL,
	"disposition" "inbound_shipment_box_disposition" DEFAULT 'stock' NOT NULL,
	"forward_note" text,
	"status" "inbound_shipment_box_status" DEFAULT 'open' NOT NULL,
	"receipt_id" uuid,
	"received_at" timestamp with time zone,
	"received_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_inbound_shipment_boxes_label" UNIQUE("shipment_id","label"),
	CONSTRAINT "ck_inbound_shipment_boxes_forward_open" CHECK ("inbound_shipment_boxes"."disposition" <> 'forward' OR "inbound_shipment_boxes"."status" = 'open')
);
--> statement-breakpoint
CREATE TABLE "inbound_shipment_line_boxes" (
	"line_id" uuid NOT NULL,
	"box_id" uuid NOT NULL,
	CONSTRAINT "inbound_shipment_line_boxes_line_id_box_id_pk" PRIMARY KEY("line_id","box_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"kind" "inbound_shipment_line_kind" NOT NULL,
	"sku_id" uuid,
	"expected_qty" integer,
	"resolution" "inbound_shipment_line_resolution",
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"issues" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_candidates" jsonb,
	CONSTRAINT "ck_inbound_shipment_lines_sku" CHECK (("inbound_shipment_lines"."kind" = 'sku') = ("inbound_shipment_lines"."sku_id" IS NOT NULL)),
	CONSTRAINT "ck_inbound_shipment_lines_qty" CHECK ("inbound_shipment_lines"."kind" = 'unresolved' OR ("inbound_shipment_lines"."expected_qty" IS NOT NULL AND "inbound_shipment_lines"."expected_qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "inbound_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "inbound_shipment_status" DEFAULT 'draft' NOT NULL,
	"name" varchar(255) NOT NULL,
	"expected_arrival" date,
	"source_file_id" uuid,
	"source_file_name" varchar(255),
	"memo" text,
	"created_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_reason" text,
	"canceled_at" timestamp with time zone,
	"canceled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_shipment_box_counts" ADD CONSTRAINT "inbound_shipment_box_counts_box_id_inbound_shipment_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."inbound_shipment_boxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_box_counts" ADD CONSTRAINT "inbound_shipment_box_counts_line_id_inbound_shipment_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inbound_shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_box_counts" ADD CONSTRAINT "inbound_shipment_box_counts_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_box_counts" ADD CONSTRAINT "inbound_shipment_box_counts_receipt_line_id_inbound_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."inbound_receipt_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_boxes" ADD CONSTRAINT "inbound_shipment_boxes_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_boxes" ADD CONSTRAINT "inbound_shipment_boxes_receipt_id_inbound_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_line_boxes" ADD CONSTRAINT "inbound_shipment_line_boxes_line_id_inbound_shipment_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inbound_shipment_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_line_boxes" ADD CONSTRAINT "inbound_shipment_line_boxes_box_id_inbound_shipment_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."inbound_shipment_boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_shipment_id_inbound_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inbound_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipment_lines" ADD CONSTRAINT "inbound_shipment_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_shipments" ADD CONSTRAINT "inbound_shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inbound_shipment_box_counts_live" ON "inbound_shipment_box_counts" USING btree ("box_id","line_id") WHERE "inbound_shipment_box_counts"."canceled_at" IS NULL AND "inbound_shipment_box_counts"."line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_inbound_shipment_line_boxes_box" ON "inbound_shipment_line_boxes" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_shipment_lines_row" ON "inbound_shipment_lines" USING btree ("shipment_id","row_number");--> statement-breakpoint
CREATE INDEX "idx_inbound_shipment_lines_sku" ON "inbound_shipment_lines" USING btree ("sku_id") WHERE "inbound_shipment_lines"."kind" = 'sku';--> statement-breakpoint
CREATE INDEX "idx_inbound_shipments_wh_status" ON "inbound_shipments" USING btree ("warehouse_id","status");