CREATE TYPE "public"."outbound_work_item_exit_to" AS ENUM('draft', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."outbound_batch_work_item_status" ADD VALUE 'withdrawing';--> statement-breakpoint
CREATE TABLE "return_bins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"barcode" varchar(128) NOT NULL,
	"registered_by" uuid NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_return_bins_barcode" UNIQUE("barcode"),
	CONSTRAINT "ck_return_bins_barcode_prefix" CHECK ("return_bins"."barcode" LIKE 'RB-%')
);
--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" DROP CONSTRAINT "ck_batch_inventory_session_balances_custody";--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" DROP CONSTRAINT "ck_batch_inventory_session_events_from_grain";--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" DROP CONSTRAINT "ck_batch_inventory_session_events_to_grain";--> statement-breakpoint
ALTER TABLE "outbound_batch_work_items" ADD COLUMN "exit_to" "outbound_work_item_exit_to";--> statement-breakpoint
ALTER TABLE "return_bins" ADD CONSTRAINT "return_bins_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_return_bins_warehouse" ON "return_bins" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_balances_return_bin" ON "batch_inventory_session_balances" USING btree ("custody_ref") WHERE "batch_inventory_session_balances"."custody_type" = 'RETURN_PENDING' AND "batch_inventory_session_balances"."qty" > 0;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" ADD CONSTRAINT "ck_batch_inventory_session_balances_custody" CHECK ((
        ("batch_inventory_session_balances"."custody_type" = 'AT_SOURCE' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NULL)
        OR ("batch_inventory_session_balances"."custody_type" = 'BULK_CART' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NOT NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NULL)
        OR ("batch_inventory_session_balances"."custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NOT NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NOT NULL)
        OR ("batch_inventory_session_balances"."custody_type" = 'RETURN_PENDING' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NOT NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NULL)
        OR ("batch_inventory_session_balances"."custody_type" = 'SETTLED' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "ck_batch_inventory_session_events_from_grain" CHECK ((
        ("batch_inventory_session_events"."from_custody_type" IS NULL AND "batch_inventory_session_events"."from_source_location_id" IS NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
        OR ("batch_inventory_session_events"."from_custody_type" IS NOT NULL AND (
          ("batch_inventory_session_events"."from_custody_type" = 'AT_SOURCE' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."from_custody_type" = 'BULK_CART' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."from_custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NOT NULL)
          OR ("batch_inventory_session_events"."from_custody_type" = 'RETURN_PENDING' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."from_custody_type" = 'SETTLED' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NOT NULL)
        ))
      ));--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "ck_batch_inventory_session_events_to_grain" CHECK ((
        ("batch_inventory_session_events"."to_custody_type" IS NULL AND "batch_inventory_session_events"."to_source_location_id" IS NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
        OR ("batch_inventory_session_events"."to_custody_type" IS NOT NULL AND (
          ("batch_inventory_session_events"."to_custody_type" = 'AT_SOURCE' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."to_custody_type" = 'BULK_CART' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."to_custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NOT NULL)
          OR ("batch_inventory_session_events"."to_custody_type" = 'RETURN_PENDING' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."to_custody_type" = 'SETTLED' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NOT NULL)
        ))
      ));--> statement-breakpoint
ALTER TABLE "outbound_batch_work_items" ADD CONSTRAINT "ck_outbound_work_items_withdrawing_exit" CHECK ("outbound_batch_work_items"."status"::text <> 'withdrawing' OR "outbound_batch_work_items"."exit_to" IS NOT NULL);