CREATE TABLE "customer_return_arrivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_return_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"stock_event_id" uuid,
	"arrived_by" varchar(255),
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_return_arrivals_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_customer_return_arrivals_quantity_positive" CHECK ("customer_return_arrivals"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_return_line_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_per_unit" integer NOT NULL,
	"expected_qty" integer NOT NULL,
	"accepted_qty" integer,
	"rejected_qty" integer,
	"held_qty" integer,
	CONSTRAINT "uq_customer_return_items_line_sku" UNIQUE("customer_return_line_id","sku_id"),
	CONSTRAINT "ck_customer_return_items_expected_qty_positive" CHECK ("customer_return_items"."expected_qty" > 0),
	CONSTRAINT "ck_customer_return_items_inspection_all_or_none" CHECK (("customer_return_items"."accepted_qty" IS NULL AND "customer_return_items"."rejected_qty" IS NULL AND "customer_return_items"."held_qty" IS NULL) OR ("customer_return_items"."accepted_qty" >= 0 AND "customer_return_items"."rejected_qty" >= 0 AND "customer_return_items"."held_qty" >= 0))
);
--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "inspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "settlement" jsonb;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "settlement_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "customer_return_arrivals" ADD CONSTRAINT "customer_return_arrivals_customer_return_item_id_customer_return_items_id_fk" FOREIGN KEY ("customer_return_item_id") REFERENCES "public"."customer_return_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_customer_return_line_id_customer_return_lines_id_fk" FOREIGN KEY ("customer_return_line_id") REFERENCES "public"."customer_return_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_return_arrivals_item" ON "customer_return_arrivals" USING btree ("customer_return_item_id");--> statement-breakpoint
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;