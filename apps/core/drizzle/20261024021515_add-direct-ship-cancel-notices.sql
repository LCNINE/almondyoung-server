CREATE TABLE "direct_ship_cancel_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_cancellation_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"fulfillment_order_id" uuid NOT NULL,
	"fulfillment_order_item_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"sales_order_line_id" varchar(255),
	"sku_id" uuid NOT NULL,
	"canceled_qty" integer NOT NULL,
	"cancellation_scope" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"notified_by" varchar(255),
	CONSTRAINT "uq_direct_ship_cancel_notices_cancellation_item" UNIQUE("order_cancellation_id","fulfillment_order_item_id"),
	CONSTRAINT "direct_ship_cancel_notices_canceled_qty_check" CHECK ("direct_ship_cancel_notices"."canceled_qty" > 0),
	CONSTRAINT "direct_ship_cancel_notices_scope_check" CHECK ("direct_ship_cancel_notices"."cancellation_scope" IN ('full', 'partial'))
);
--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_fulfillment_order_item_id_fulfillment_order_items_id_fk" FOREIGN KEY ("fulfillment_order_item_id") REFERENCES "public"."fulfillment_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_holder_id_holders_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."holders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_direct_ship_cancel_notices_pending" ON "direct_ship_cancel_notices" USING btree ("holder_id","created_at") WHERE "direct_ship_cancel_notices"."notified_at" IS NULL;