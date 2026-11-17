CREATE TABLE "sales_order_line_state_marks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "line_state_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sales_order_line_state_marks_sales_order" ON "sales_order_line_state_marks" USING btree ("sales_order_id");