ALTER TABLE "print_orders" ADD COLUMN "vendor_box_number" varchar(32);--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "vendor_shipping_fee" integer;--> statement-breakpoint
CREATE INDEX "ix_print_orders_sales_order" ON "print_orders" USING btree ("sales_order_id");