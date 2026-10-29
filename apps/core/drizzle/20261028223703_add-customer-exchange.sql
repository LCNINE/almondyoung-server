CREATE TYPE "public"."customer_return_kind" AS ENUM('return', 'exchange');--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "kind" "customer_return_kind" DEFAULT 'return' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "exchange_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "exchange_released_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "exchange_return_line_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_exchange_return_line_id_customer_return_lines_id_fk" FOREIGN KEY ("exchange_return_line_id") REFERENCES "public"."customer_return_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_order_lines_exchange_return_line" ON "sales_order_lines" USING btree ("exchange_return_line_id") WHERE "sales_order_lines"."exchange_return_line_id" IS NOT NULL;