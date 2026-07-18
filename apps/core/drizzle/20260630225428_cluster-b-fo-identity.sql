ALTER TABLE "fulfillment_order_lines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fulfillment_order_lines" CASCADE;--> statement-breakpoint
DROP INDEX "uq_shipments_fo_active";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fulfillment_orders_sales_order" ON "fulfillment_orders" USING btree ("sales_order_id") WHERE "fulfillment_orders"."sales_order_id" IS NOT NULL;