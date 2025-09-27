CREATE TYPE "public"."barcode_type" AS ENUM('standard');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('PENDING', 'POSTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('IN', 'IN_DOMESTIC', 'IN_OVERSEAS', 'IN_RETURN', 'OUT', 'OUT_ORDER', 'OUT_DAMAGE', 'OUT_LOSS', 'OUT_DISPOSAL', 'MOVE', 'MOVE_INTER_WAREHOUSE', 'MOVE_INTRA_WAREHOUSE', 'ADJUST', 'ADJUST_MANUAL', 'ADJUST_INVENTORY', 'RESERVE', 'CONFIRM', 'RELEASE', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."event_type_order" AS ENUM('ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_MODIFIED', 'ORDER_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."inbound_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('standard', 'zone');--> statement-breakpoint
CREATE TYPE "public"."matching_priority" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."matching_status" AS ENUM('pending', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."matching_strategy" AS ENUM('void', 'variant', 'option');--> statement-breakpoint
CREATE TYPE "public"."order_item_status" AS ENUM('pending', 'matched', 'stock_deducted', 'stock_unavailable', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('created', 'confirmed', 'received');--> statement-breakpoint
CREATE TYPE "public"."po_type" AS ENUM('domestic', 'foreign');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending', 'confirmed', 'released');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'received', 'qc_passed', 'qc_failed', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('medusa', 'naver', 'coupang', '3pl');--> statement-breakpoint
CREATE TYPE "public"."setting_key" AS ENUM('use_sub_barcode', 'use_expiry_separation');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('created', 'in_transit', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('direct', 'in_house', 'overseas');--> statement-breakpoint
CREATE TYPE "public"."stock_state" AS ENUM('ON_HAND', 'RESERVED_SALES', 'RESERVED_MOVE', 'DEFECTIVE', 'IN_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."stock_type" AS ENUM('physical', 'infinite', 'drop_shipped', 'consignment');--> statement-breakpoint
CREATE TYPE "public"."system_location_role" AS ENUM('inbound_default', 'return_default');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('normal', 'high', 'express');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('created', 'picking', 'packed', 'shipped', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."transition_type" AS ENUM('RECEIVE', 'RECEIPT_CORRECTION_UP', 'RECEIPT_CORRECTION_DOWN', 'RECEIPT_REVERSAL', 'RESERVE_SALES', 'UNRESERVE_SALES', 'SHIP', 'SHIP_REVERSAL', 'MOVE_RESERVE', 'MOVE_CANCEL', 'MOVE_COMMIT', 'TRANSFER_SHIP', 'TRANSFER_RECEIVE', 'TRANSFER_CANCEL_SHIP', 'TRANSFER_LOSS', 'TRANSFER_DAMAGE', 'MARK_DEFECT', 'REWORK_GOOD', 'QUARANTINE_HOLD', 'QUARANTINE_RELEASE', 'ADJUST_UP', 'ADJUST_DOWN', 'SCRAP', 'UNSCRAP');--> statement-breakpoint
CREATE TYPE "public"."unavailable_reason" AS ENUM('pb', 'foreign', 'low_margin');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('domestic', 'overseas', 'bonded', 'return');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "delivery_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"source_type" "source_type" NOT NULL,
	"avg_delivery_days" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_our_asset" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp NOT NULL,
	"name" varchar(128) NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"source" varchar(255),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbound_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"barcode" varchar(64),
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "location_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"column_name" varchar(10) NOT NULL,
	"display_order" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "location_columns_warehouse_id_column_name_unique" UNIQUE("warehouse_id","column_name")
);
--> statement-breakpoint
CREATE TABLE "location_racks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"column_id" uuid NOT NULL,
	"rack_number" integer NOT NULL,
	"default_bin_start" integer DEFAULT 1,
	"default_bin_end" integer DEFAULT 20,
	"auto_generate_bins" boolean DEFAULT true,
	"physical_width" integer,
	"physical_height" integer,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "location_racks_column_id_rack_number_unique" UNIQUE("column_id","rack_number")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"location_type" "location_type" NOT NULL,
	"rack_id" uuid,
	"bin_identifier" varchar(20),
	"display_name" varchar(128),
	"capacity_limit" integer,
	"fifo_rank" integer,
	"is_expiry_separated" boolean,
	"is_active" boolean DEFAULT true,
	"notes" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_role" "system_location_role",
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "locations_warehouse_id_code_unique" UNIQUE("warehouse_id","code"),
	CONSTRAINT "locations_warehouse_id_system_role_unique" UNIQUE("warehouse_id","system_role")
);
--> statement-breakpoint
CREATE TABLE "merge_groups" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"shipping_address_hash" varchar(64) NOT NULL,
	"total_shipping_fee" integer DEFAULT 0,
	"order_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"order_id" uuid NOT NULL,
	"event_type" "event_type_order" NOT NULL,
	"payload" json NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "order_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_matching_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"total_price" integer,
	"status" "order_item_status" DEFAULT 'pending' NOT NULL,
	"suggested_quantity" integer,
	"unavailable_sku_ids" json,
	"deducted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_order_id" varchar(255) NOT NULL,
	"sales_channel" "sales_channel" NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"customer_name" varchar(255),
	"customer_email" varchar(255),
	"customer_phone" varchar(50),
	"shipping_address" json NOT NULL,
	"shipping_address_hash" varchar(64),
	"total_amount" integer,
	"shipping_fee" integer DEFAULT 0,
	"merge_group_id" varchar(64),
	"is_merged" boolean DEFAULT false NOT NULL,
	"order_date" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "orders_sales_channel_channel_order_id_unique" UNIQUE("sales_channel","channel_order_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_task_items" (
	"task_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity_pending" integer DEFAULT 0 NOT NULL,
	"quantity_picking" integer DEFAULT 0 NOT NULL,
	"quantity_picked" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "outbound_task_items_task_id_sku_id_pk" PRIMARY KEY("task_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_task_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"location_id" uuid,
	"scanned_barcode" varchar(64),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outbound_task_orders" (
	"task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "outbound_task_orders_task_id_order_id_pk" PRIMARY KEY("task_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"merge_group_id" varchar(64),
	"status" "task_status" DEFAULT 'created' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"total_items" integer DEFAULT 0,
	"total_quantity" integer DEFAULT 0,
	"assigned_to" uuid,
	"requires_gift_wrap" boolean DEFAULT false,
	"temperature_controlled" boolean DEFAULT false,
	"unavailable_reason" "unavailable_reason",
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "product_matchings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"status" "matching_status" DEFAULT 'pending' NOT NULL,
	"priority" "matching_priority" DEFAULT 'normal' NOT NULL,
	"strategy" "matching_strategy",
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "product_matchings_variant_id_unique" UNIQUE("variant_id")
);
--> statement-breakpoint
CREATE TABLE "product_option_matchings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_matching_id" uuid NOT NULL,
	"option_name" varchar(255) NOT NULL,
	"option_value" varchar(255) NOT NULL,
	"sku_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "product_option_matchings_product_matching_id_option_name_option_value_unique" UNIQUE("product_matching_id","option_name","option_value")
);
--> statement-breakpoint
CREATE TABLE "product_variant_sku_links" (
	"product_matching_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "product_variant_sku_links_product_matching_id_sku_id_pk" PRIMARY KEY("product_matching_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"type" "po_type" NOT NULL,
	"supplier_info" json,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"po_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "purchase_order_lines_po_id_sku_id_pk" PRIMARY KEY("po_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "po_type" NOT NULL,
	"supplier_id" uuid,
	"expected_arrival" timestamp,
	"status" "po_status" DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"shipment_id" uuid,
	"status" "return_status" DEFAULT 'requested' NOT NULL,
	"qc_reason" varchar(255),
	"restock_quantity" integer,
	"dispose_quantity" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"key" "setting_key" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shipment_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"location" varchar(255),
	"timestamp" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_no" varchar(64) NOT NULL,
	"status" "shipment_status" DEFAULT 'created' NOT NULL,
	"eta" timestamp with time zone,
	"split_status" boolean DEFAULT false NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sku_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"barcode" varchar(64) NOT NULL,
	"barcode_type" "barcode_type" NOT NULL,
	"packing_unit" varchar(64),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sku_barcodes_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "sku_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sku_suppliers" (
	"sku_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sku_suppliers_sku_id_supplier_id_pk" PRIMARY KEY("sku_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_id" uuid DEFAULT '00000000-0000-0000-0000-000000000000' NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(64) NOT NULL,
	"default_barcode" varchar(64),
	"stock_type" "stock_type" DEFAULT 'physical' NOT NULL,
	"delivery_profile_id" uuid,
	"inventory_management" boolean DEFAULT false NOT NULL,
	"pre_stock_sellable" boolean DEFAULT true NOT NULL,
	"always_sellable_zero_stock" boolean DEFAULT false NOT NULL,
	"sale_1m" integer,
	"sale_3m" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "skus_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"journal_id" uuid,
	"sku_id" uuid NOT NULL,
	"from_warehouse_id" uuid,
	"from_location_id" uuid,
	"to_warehouse_id" uuid,
	"to_location_id" uuid,
	"from_state" "stock_state",
	"to_state" "stock_state",
	"transition_type" "transition_type" NOT NULL,
	"quantity" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(128),
	"event_status" "event_status" DEFAULT 'POSTED' NOT NULL,
	"reversal_of_event_id" uuid,
	"voided_by_event_id" uuid,
	"reason" varchar(255),
	CONSTRAINT "stock_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_events_qty_positive" CHECK ("stock_events"."quantity" > 0),
	CONSTRAINT "ck_events_states_diff" CHECK ("stock_events"."from_state" is distinct from "stock_events"."to_state"),
	CONSTRAINT "ck_events_side_present" CHECK (("stock_events"."from_state" is not null) or ("stock_events"."to_state" is not null)),
	CONSTRAINT "ck_events_fromloc_has_wh" CHECK (("stock_events"."from_location_id" is null) or ("stock_events"."from_warehouse_id" is not null)),
	CONSTRAINT "ck_events_toloc_has_wh" CHECK (("stock_events"."to_location_id" is null) or ("stock_events"."to_warehouse_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_journals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"source_type" varchar(64),
	"source_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(128),
	"actor_id" uuid,
	"reversal_of_id" uuid,
	CONSTRAINT "stock_journals_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "stock_ledgers" (
	"sku_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"stock_state" "stock_state" NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledgers_sku_id_warehouse_id_location_id_stock_state_pk" PRIMARY KEY("sku_id","warehouse_id","location_id","stock_state"),
	CONSTRAINT "ck_ledgers_non_negative" CHECK ("stock_ledgers"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"reservation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'pending' NOT NULL,
	"timeout_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stock_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"current_quantity" integer DEFAULT 0 NOT NULL,
	"available_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"inbound_pending_quantity" integer DEFAULT 0 NOT NULL,
	"outbound_pending_quantity" integer DEFAULT 0 NOT NULL,
	"moving_quantity" integer DEFAULT 0 NOT NULL,
	"damage_quantity" integer DEFAULT 0 NOT NULL,
	"return_pending_quantity" integer DEFAULT 0 NOT NULL,
	"last_event_id" uuid,
	"last_updated" timestamp with time zone DEFAULT now(),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_summary_sku_id_warehouse_id_unique" UNIQUE("sku_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"contact_info" json,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "warehouse_type" DEFAULT 'domestic',
	"location" varchar(256),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "inbound_lists" ADD CONSTRAINT "inbound_lists_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_lists" ADD CONSTRAINT "inbound_lists_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_columns" ADD CONSTRAINT "location_columns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_racks" ADD CONSTRAINT "location_racks_column_id_location_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."location_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_rack_id_location_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."location_racks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_matching_id_product_matchings_id_fk" FOREIGN KEY ("product_matching_id") REFERENCES "public"."product_matchings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_items" ADD CONSTRAINT "outbound_task_items_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_items" ADD CONSTRAINT "outbound_task_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_orders" ADD CONSTRAINT "outbound_task_orders_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_orders" ADD CONSTRAINT "outbound_task_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_merge_group_id_merge_groups_id_fk" FOREIGN KEY ("merge_group_id") REFERENCES "public"."merge_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_matchings" ADD CONSTRAINT "product_option_matchings_product_matching_id_product_matchings_id_fk" FOREIGN KEY ("product_matching_id") REFERENCES "public"."product_matchings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_matchings" ADD CONSTRAINT "product_option_matchings_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_sku_links" ADD CONSTRAINT "product_variant_sku_links_product_matching_id_product_matchings_id_fk" FOREIGN KEY ("product_matching_id") REFERENCES "public"."product_matchings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_sku_links" ADD CONSTRAINT "product_variant_sku_links_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_cart" ADD CONSTRAINT "purchase_order_cart_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_barcodes" ADD CONSTRAINT "sku_barcodes_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_categories" ADD CONSTRAINT "sku_categories_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_categories" ADD CONSTRAINT "sku_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_holder_id_holders_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."holders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_delivery_profile_id_delivery_profiles_id_fk" FOREIGN KEY ("delivery_profile_id") REFERENCES "public"."delivery_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_summary" ADD CONSTRAINT "stock_summary_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_summary" ADD CONSTRAINT "stock_summary_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_summary" ADD CONSTRAINT "stock_summary_last_event_id_stock_events_id_fk" FOREIGN KEY ("last_event_id") REFERENCES "public"."stock_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_columns_warehouse_name" ON "location_columns" USING btree ("warehouse_id","column_name");--> statement-breakpoint
CREATE INDEX "idx_racks_column_number" ON "location_racks" USING btree ("column_id","rack_number");--> statement-breakpoint
CREATE INDEX "idx_locations_warehouse_type" ON "locations" USING btree ("warehouse_id","location_type");--> statement-breakpoint
CREATE INDEX "idx_locations_rack_bin" ON "locations" USING btree ("rack_id","bin_identifier");--> statement-breakpoint
CREATE INDEX "ix_stock_events_grain_time" ON "stock_events" USING btree ("sku_id","from_warehouse_id","to_warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_ledgers_lookup" ON "stock_ledgers" USING btree ("sku_id","warehouse_id","location_id","stock_state");--> statement-breakpoint
CREATE INDEX "stock_summary_sku_idx" ON "stock_summary" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "stock_summary_warehouse_idx" ON "stock_summary" USING btree ("warehouse_id");