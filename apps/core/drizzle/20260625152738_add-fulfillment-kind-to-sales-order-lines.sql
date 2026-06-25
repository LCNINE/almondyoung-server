ALTER TABLE "sales_order_lines" ADD COLUMN "fulfillment_kind" varchar(16);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "requires_shipping" boolean;