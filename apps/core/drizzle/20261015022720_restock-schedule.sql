ALTER TABLE "product_sellable_quantity_projections" ADD COLUMN "inbound_date" date;--> statement-breakpoint
ALTER TABLE "product_sellable_quantity_projections" ADD COLUMN "inbound_approximate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_sellable_quantity_projections" ADD COLUMN "restock_calculated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_variant_policies" ADD COLUMN "restock_date" date;--> statement-breakpoint
ALTER TABLE "sales_variant_policies" ADD COLUMN "restock_approximate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_sellable_qty_restock_date" ON "product_sellable_quantity_projections" USING btree ("inbound_date") WHERE "product_sellable_quantity_projections"."inbound_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_sellable_qty_restock_uninitialized" ON "product_sellable_quantity_projections" USING btree ("variant_id") WHERE "product_sellable_quantity_projections"."restock_calculated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_product_variant_sku_links_sku" ON "product_variant_sku_links" USING btree ("sku_id","product_matching_id");--> statement-breakpoint
CREATE INDEX "idx_po_lines_restock_arrival" ON "purchase_order_lines" USING btree ("sku_id","expected_arrival") WHERE "purchase_order_lines"."status" = 'ordered' AND "purchase_order_lines"."closed_at" IS NULL AND "purchase_order_lines"."received_qty" < COALESCE("purchase_order_lines"."ordered_qty", 0) AND "purchase_order_lines"."expected_arrival" IS NOT NULL;