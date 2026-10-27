CREATE TYPE "public"."customer_return_reason" AS ENUM('change_of_mind', 'defective', 'not_as_described', 'wrong_item', 'damaged_in_shipping', 'other');--> statement-breakpoint
CREATE TYPE "public"."customer_return_status" AS ENUM('expected', 'arrived', 'inspected', 'held', 'refund_pending', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "customer_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_return_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"channel_order_item_id" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "uq_customer_return_lines_return_line" UNIQUE("customer_return_id","sales_order_line_id"),
	CONSTRAINT "ck_customer_return_lines_quantity_positive" CHECK ("customer_return_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"channel_return_id" varchar(255) NOT NULL,
	"channel_request_id" varchar(255) NOT NULL,
	"status" "customer_return_status" DEFAULT 'expected' NOT NULL,
	"reason" "customer_return_reason" NOT NULL,
	"fee_bearer" varchar(16) NOT NULL,
	"requested_by" varchar(16) NOT NULL,
	"window_override_reason" text,
	"requested_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_customer_returns_channel_return" UNIQUE("channel_return_id"),
	CONSTRAINT "ck_customer_returns_fee_bearer" CHECK ("customer_returns"."fee_bearer" IN ('customer', 'seller')),
	CONSTRAINT "ck_customer_returns_requested_by" CHECK ("customer_returns"."requested_by" IN ('customer', 'operator'))
);
--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "customer_return_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_return_lines_sales_order_line" ON "customer_return_lines" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "idx_customer_returns_sales_order" ON "customer_returns" USING btree ("sales_order_id");