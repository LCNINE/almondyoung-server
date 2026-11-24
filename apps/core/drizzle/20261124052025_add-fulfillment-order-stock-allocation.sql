ALTER TYPE "public"."shipment_operation_type" ADD VALUE 'stock_priority';--> statement-breakpoint
ALTER TYPE "public"."shipment_operation_type" ADD VALUE 'stock_priority_cancel';--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD COLUMN "stock_allocation" varchar(16) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_fulfillment_orders_stock_priority" ON "fulfillment_orders" USING btree ("id") WHERE "fulfillment_orders"."stock_allocation" = 'priority';--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "ck_fulfillment_orders_stock_allocation" CHECK ("fulfillment_orders"."stock_allocation" IN ('normal', 'priority'));