ALTER TABLE "inspection_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "inspection_items" CASCADE;--> statement-breakpoint
DROP TABLE "inspection_sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_invoice_number_unique";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "uq_shipments_fulfillment_order_id";--> statement-breakpoint
ALTER TABLE "inspection_issues" DROP CONSTRAINT IF EXISTS "inspection_issues_session_id_inspection_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_fulfillment_order_id_fulfillment_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_fulfillment_order_id_fulfillment_orders_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "uq_invoices_fo_active";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'issued'::text;--> statement-breakpoint
DROP TYPE "public"."invoice_status";--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'used', 'voided');--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'issued'::"public"."invoice_status";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "status" SET DATA TYPE "public"."invoice_status" USING "status"::"public"."invoice_status";--> statement-breakpoint
ALTER TABLE "shipment_tracking" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."shipment_status";--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('open', 'shipped', 'in_transit', 'delivered', 'failed', 'canceled');--> statement-breakpoint
ALTER TABLE "shipment_tracking" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
DROP INDEX "idx_inspection_issues_session";--> statement-breakpoint
DROP INDEX "idx_invoices_fo";--> statement-breakpoint
DROP INDEX "idx_invoices_number";--> statement-breakpoint
ALTER TABLE "inspection_issues" ADD COLUMN "shipment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tracking_no" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "carrier" "carrier";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "external_service_id" varchar(255);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_for_fulfillment_order_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "shipment_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "inspected_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "forced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "warehouse_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "opened_for_fulfillment_order_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "opened_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspection_issues" ADD CONSTRAINT "inspection_issues_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_for_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("issued_for_fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_opened_for_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("opened_for_fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inspection_issues_shipment" ON "inspection_issues" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_issued_for_fo" ON "invoices" USING btree ("issued_for_fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_tracking_no" ON "invoices" USING btree ("tracking_no");--> statement-breakpoint
CREATE INDEX "idx_invoices_shipment" ON "invoices" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_shipment_active" ON "invoices" USING btree ("shipment_id") WHERE "invoices"."status" <> 'voided';--> statement-breakpoint
CREATE INDEX "idx_shipments_opened_for_fo" ON "shipments" USING btree ("opened_for_fulfillment_order_id");--> statement-breakpoint
ALTER TABLE "inspection_issues" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "fulfillment_order_id";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "invoice_number";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "carrier_code";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "goodsflow_service_id";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "printed_at";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "shipped_at";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "tracking_no";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "carrier";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "eta";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "split_status";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "invoice_url";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "fulfillment_order_id";--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tracking_no_unique" UNIQUE("tracking_no");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "uq_shipments_fulfillment_order_id" UNIQUE("opened_for_fulfillment_order_id");--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "ck_shipment_lines_inspected_range" CHECK ("shipment_lines"."inspected_qty" >= 0 AND "shipment_lines"."inspected_qty" <= "shipment_lines"."qty");