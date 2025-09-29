CREATE TYPE "public"."inbound_method" AS ENUM('individual', 'simple', 'simple_fullscan', 'planned');--> statement-breakpoint
CREATE TYPE "public"."inbound_receipt_status" AS ENUM('posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."inbound_work_type" AS ENUM('INBOUND', 'PUTAWAY', 'RETURN', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."inventory_master_purpose" AS ENUM('standard', 'set', 'material');--> statement-breakpoint
CREATE TYPE "public"."inventory_master_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."transition_type" ADD VALUE 'MOVE_INSTANT' BEFORE 'TRANSFER_SHIP';--> statement-breakpoint
CREATE TABLE "inbound_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"expected_qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbound_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expected_date" timestamp NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbound_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"origin_location_id" uuid,
	"event_id" uuid,
	"memo" varchar(255),
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"canceled_qty" integer DEFAULT 0 NOT NULL,
	"putaway_from_origin_qty" integer DEFAULT 0 NOT NULL,
	"plan_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbound_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" "inbound_method" NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" "inbound_receipt_status" DEFAULT 'posted' NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbound_work_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "inbound_work_type" NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid,
	"line_id" uuid,
	"plan_item_id" uuid,
	"sku_id" uuid,
	"warehouse_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity" integer,
	"method" "inbound_method",
	"reason" varchar(255),
	"event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_master_sku_links" (
	"master_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"option_key" json,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "inventory_master_sku_links_master_id_sku_id_pk" PRIMARY KEY("master_id","sku_id"),
	CONSTRAINT "inventory_master_sku_links_master_id_option_key_unique" UNIQUE("master_id","option_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_product_masters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"master_code" varchar(64) NOT NULL,
	"purpose" "inventory_master_purpose" DEFAULT 'standard' NOT NULL,
	"option_schema" json,
	"default_policy" json,
	"status" "inventory_master_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "inventory_product_masters_master_code_unique" UNIQUE("master_code")
);
--> statement-breakpoint
CREATE TABLE "movement_job_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"job_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"event_id" uuid,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "movement_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"journal_id" uuid,
	"actor_id" uuid,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "movement_work_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"type" varchar(32) DEFAULT 'MOVE' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid,
	"line_id" uuid,
	"sku_id" uuid,
	"warehouse_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity" integer,
	"event_id" uuid,
	"reason" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "product_matchings" ADD COLUMN "master_id" uuid;--> statement-breakpoint
ALTER TABLE "product_matchings" ADD COLUMN "inventory_management" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_matchings" ADD COLUMN "pre_stock_sellable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_matchings" ADD COLUMN "always_sellable_zero_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_matchings" ADD COLUMN "is_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD CONSTRAINT "inbound_plan_items_plan_id_inbound_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inbound_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD CONSTRAINT "inbound_plan_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plans" ADD CONSTRAINT "inbound_plans_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_receipt_id_inbound_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_origin_location_id_locations_id_fk" FOREIGN KEY ("origin_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_plan_item_id_inbound_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."inbound_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_receipt_id_inbound_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_line_id_inbound_receipt_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inbound_receipt_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_plan_item_id_inbound_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."inbound_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_master_sku_links" ADD CONSTRAINT "inventory_master_sku_links_master_id_inventory_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."inventory_product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_master_sku_links" ADD CONSTRAINT "inventory_master_sku_links_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_job_id_movement_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."movement_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_jobs" ADD CONSTRAINT "movement_jobs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_jobs" ADD CONSTRAINT "movement_jobs_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_job_id_movement_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."movement_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_line_id_movement_job_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."movement_job_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inbound_plan_items_plan" ON "inbound_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plan_items_sku" ON "inbound_plan_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_wh_date" ON "inbound_plans" USING btree ("warehouse_id","expected_date");--> statement-breakpoint
CREATE INDEX "idx_inbound_lines_receipt" ON "inbound_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_lines_sku" ON "inbound_receipt_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_receipts_wh_time" ON "inbound_receipts" USING btree ("warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_inbound_work_time" ON "inbound_work_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_movement_lines_job" ON "movement_job_lines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_movement_lines_sku" ON "movement_job_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_movement_jobs_wh_time" ON "movement_jobs" USING btree ("warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_movement_work_time" ON "movement_work_logs" USING btree ("timestamp");--> statement-breakpoint
ALTER TABLE "product_matchings" ADD CONSTRAINT "product_matchings_master_id_inventory_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."inventory_product_masters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_matchings_master_id" ON "product_matchings" USING btree ("master_id");--> statement-breakpoint
ALTER TABLE "skus" DROP COLUMN "inventory_management";--> statement-breakpoint
ALTER TABLE "skus" DROP COLUMN "pre_stock_sellable";--> statement-breakpoint
ALTER TABLE "skus" DROP COLUMN "always_sellable_zero_stock";--> statement-breakpoint
ALTER TABLE "stock_journals" DROP COLUMN "reversal_of_id";--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "ck_locations_type" CHECK ((
        (location_type = 'standard' AND rack_id IS NOT NULL AND bin_identifier IS NOT NULL)
        OR 
        (location_type = 'zone' AND rack_id IS NULL AND bin_identifier IS NULL)
    ));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "ck_locations_system_role" CHECK (( (is_system = true AND system_role IS NOT NULL) OR (is_system = false AND system_role IS NULL) ));--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "ck_locations_system_zone" CHECK (( is_system = false OR location_type = 'zone' ));