CREATE TYPE "public"."exchange_reason_code" AS ENUM('defective', 'not_as_described', 'change_of_mind', 'wrong_item', 'damaged_in_shipping', 'other');--> statement-breakpoint
CREATE TYPE "public"."exchange_request_status" AS ENUM('requested', 'approved', 'rejected', 'collection_pending', 'collected', 'inspected', 'refund_pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_reason_code" AS ENUM('defective', 'not_as_described', 'change_of_mind', 'wrong_item', 'damaged_in_shipping', 'other');--> statement-breakpoint
CREATE TYPE "public"."return_request_status" AS ENUM('requested', 'approved', 'rejected', 'collection_pending', 'collected', 'inspected', 'refund_pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "exchange_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange_request_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"desired_variant_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid,
	"status" "exchange_request_status" DEFAULT 'requested' NOT NULL,
	"reason_code" "exchange_reason_code" NOT NULL,
	"reason_detail" text,
	"admin_note" text,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_request_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason_code" "return_reason_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid,
	"status" "return_request_status" DEFAULT 'requested' NOT NULL,
	"reason_code" "return_reason_code" NOT NULL,
	"reason_detail" text,
	"return_address" json,
	"admin_note" text,
	"decided_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_request_items" ADD CONSTRAINT "exchange_request_items_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exchange_request_items_request" ON "exchange_request_items" USING btree ("exchange_request_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_request_items_order_line" ON "exchange_request_items" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_requests_sales_order" ON "exchange_requests" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_requests_status" ON "exchange_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_exchange_requests_customer" ON "exchange_requests" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_return_request_items_request" ON "return_request_items" USING btree ("return_request_id");--> statement-breakpoint
CREATE INDEX "idx_return_request_items_order_line" ON "return_request_items" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "idx_return_requests_sales_order" ON "return_requests" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_return_requests_status" ON "return_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_return_requests_customer" ON "return_requests" USING btree ("customer_id");