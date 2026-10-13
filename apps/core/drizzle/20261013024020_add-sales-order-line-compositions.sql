ALTER TYPE "public"."shipment_operation_type" ADD VALUE 'amend';--> statement-breakpoint
CREATE TABLE "sales_order_line_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_per_unit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sales_order_line_compositions_line_sku" UNIQUE("sales_order_line_id","sku_id"),
	CONSTRAINT "ck_sales_order_line_compositions_qty_per_unit_positive" CHECK ("sales_order_line_compositions"."qty_per_unit" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "composition_source" varchar(16);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "composition_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "composition_set_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_line_compositions" ADD CONSTRAINT "sales_order_line_compositions_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_line_compositions" ADD CONSTRAINT "sales_order_line_compositions_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_composition_source_check" CHECK ("sales_order_lines"."composition_source" IN ('matching', 'operator'));