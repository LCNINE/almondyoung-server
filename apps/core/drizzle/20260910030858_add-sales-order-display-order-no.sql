ALTER TABLE "sales_orders" ADD COLUMN "display_order_no" varchar(64);--> statement-breakpoint
CREATE INDEX "idx_sales_orders_display_order_no" ON "sales_orders" USING btree ("display_order_no");