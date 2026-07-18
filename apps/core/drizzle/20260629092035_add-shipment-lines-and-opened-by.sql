CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"fulfillment_order_item_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shipment_lines_shipment_foi" UNIQUE("shipment_id","fulfillment_order_item_id"),
	CONSTRAINT "ck_shipment_lines_qty_positive" CHECK ("shipment_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "opened_by" uuid;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_fulfillment_order_item_id_fulfillment_order_items_id_fk" FOREIGN KEY ("fulfillment_order_item_id") REFERENCES "public"."fulfillment_order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shipment_lines_shipment" ON "shipment_lines" USING btree ("shipment_id");