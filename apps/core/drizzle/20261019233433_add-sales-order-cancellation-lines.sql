CREATE TABLE "sales_order_cancellation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cancellation_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"shipment_phase" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sales_order_cancellation_lines_quantity_positive" CHECK ("sales_order_cancellation_lines"."quantity" > 0),
	CONSTRAINT "ck_sales_order_cancellation_lines_phase" CHECK ("sales_order_cancellation_lines"."shipment_phase" IN ('before_shipment', 'after_shipment'))
);
--> statement-breakpoint
ALTER TABLE "sales_order_cancellation_lines" ADD CONSTRAINT "sales_order_cancellation_lines_cancellation_id_sales_order_cancellations_id_fk" FOREIGN KEY ("cancellation_id") REFERENCES "public"."sales_order_cancellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_cancellation_lines" ADD CONSTRAINT "sales_order_cancellation_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_cancellation_lines" ADD CONSTRAINT "sales_order_cancellation_lines_sales_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("sales_order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sales_order_cancellation_lines_cancellation_line_phase" ON "sales_order_cancellation_lines" USING btree ("cancellation_id","sales_order_line_id","shipment_phase");--> statement-breakpoint
CREATE INDEX "idx_sales_order_cancellation_lines_line" ON "sales_order_cancellation_lines" USING btree ("sales_order_line_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_cancellation_lines_order" ON "sales_order_cancellation_lines" USING btree ("sales_order_id");