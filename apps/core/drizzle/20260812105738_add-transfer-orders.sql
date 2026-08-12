CREATE TYPE "public"."transfer_order_status" AS ENUM('draft', 'shipped', 'partially_received', 'closed');--> statement-breakpoint
CREATE TABLE "transfer_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"from_location_id" uuid NOT NULL,
	"planned_qty" integer NOT NULL,
	"shipped_qty" integer DEFAULT 0 NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"lost_qty" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_transfer_order_lines_sku" UNIQUE("transfer_order_id","sku_id","from_location_id"),
	CONSTRAINT "ck_transfer_order_lines_qty" CHECK ("transfer_order_lines"."planned_qty" > 0 AND "transfer_order_lines"."shipped_qty" >= 0 AND "transfer_order_lines"."received_qty" >= 0 AND "transfer_order_lines"."lost_qty" >= 0),
	CONSTRAINT "ck_transfer_order_lines_settlement" CHECK ("transfer_order_lines"."received_qty" + "transfer_order_lines"."lost_qty" <= "transfer_order_lines"."shipped_qty"),
	CONSTRAINT "ck_transfer_order_lines_shipped" CHECK ("transfer_order_lines"."shipped_qty" <= "transfer_order_lines"."planned_qty")
);
--> statement-breakpoint
CREATE TABLE "transfer_order_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"transfer_order_line_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"lost_qty" integer DEFAULT 0 NOT NULL,
	"receive_event_id" uuid,
	"lost_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transfer_order_receipt_lines_qty" CHECK ("transfer_order_receipt_lines"."received_qty" >= 0 AND "transfer_order_receipt_lines"."lost_qty" >= 0 AND ("transfer_order_receipt_lines"."received_qty" + "transfer_order_receipt_lines"."lost_qty") > 0)
);
--> statement-breakpoint
CREATE TABLE "transfer_order_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_order_id" uuid NOT NULL,
	"journal_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"status" "transfer_order_status" DEFAULT 'draft' NOT NULL,
	"eta" timestamp,
	"eta_updated_at" timestamp with time zone,
	"journal_id" uuid,
	"actor_id" uuid,
	"memo" varchar(255),
	"shipped_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_transfer_orders_cross_warehouse" CHECK ("transfer_orders"."from_warehouse_id" <> "transfer_orders"."to_warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD CONSTRAINT "transfer_order_lines_transfer_order_id_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "public"."transfer_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD CONSTRAINT "transfer_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_lines" ADD CONSTRAINT "transfer_order_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipt_lines" ADD CONSTRAINT "transfer_order_receipt_lines_receipt_id_transfer_order_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."transfer_order_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipt_lines" ADD CONSTRAINT "transfer_order_receipt_lines_transfer_order_line_id_transfer_order_lines_id_fk" FOREIGN KEY ("transfer_order_line_id") REFERENCES "public"."transfer_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipt_lines" ADD CONSTRAINT "transfer_order_receipt_lines_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipt_lines" ADD CONSTRAINT "transfer_order_receipt_lines_receive_event_id_stock_events_id_fk" FOREIGN KEY ("receive_event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipt_lines" ADD CONSTRAINT "transfer_order_receipt_lines_lost_event_id_stock_events_id_fk" FOREIGN KEY ("lost_event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipts" ADD CONSTRAINT "transfer_order_receipts_transfer_order_id_transfer_orders_id_fk" FOREIGN KEY ("transfer_order_id") REFERENCES "public"."transfer_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_order_receipts" ADD CONSTRAINT "transfer_order_receipts_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transfer_order_lines_order" ON "transfer_order_lines" USING btree ("transfer_order_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_order_receipt_lines_receipt" ON "transfer_order_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "idx_transfer_order_receipts_order" ON "transfer_order_receipts" USING btree ("transfer_order_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_status" ON "transfer_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_transfer_orders_route" ON "transfer_orders" USING btree ("from_warehouse_id","to_warehouse_id");