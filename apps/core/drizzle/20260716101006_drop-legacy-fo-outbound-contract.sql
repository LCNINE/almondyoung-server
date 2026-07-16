ALTER TABLE "fulfillment_order_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fulfillment_order_batches";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "ck_outbox_routing_pair";--> statement-breakpoint
ALTER TABLE "fulfillment_orders" DROP CONSTRAINT "fulfillment_orders_batch_id_outbound_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_shipment_id_shipments_id_fk";
--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "status" SET DEFAULT 'created'::text;--> statement-breakpoint
DROP TYPE "public"."fulfillment_status";--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('created', 'partially_reserved', 'ready', 'processing', 'shipped', 'partially_shipped', 'completed', 'canceled', 'recovery_required');--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "status" SET DEFAULT 'created'::"public"."fulfillment_status";--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "status" SET DATA TYPE "public"."fulfillment_status" USING "status"::"public"."fulfillment_status";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "issue_method" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."invoice_method";--> statement-breakpoint
CREATE TYPE "public"."invoice_method" AS ENUM('goodsflow', 'self', 'hanjin');--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "issue_method" SET DATA TYPE "public"."invoice_method" USING "issue_method"::"public"."invoice_method";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "ck_shipments_recovery_code";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "ck_shipments_superseded_at";--> statement-breakpoint
ALTER TABLE "shipment_tracking" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."shipment_status";--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('shipped', 'in_transit', 'delivered', 'failed', 'canceled', 'draft', 'planned', 'superseded', 'recovery_required');--> statement-breakpoint
ALTER TABLE "shipment_tracking" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_recovery_code" CHECK (((("status")::text <> 'recovery_required'::text) OR ("recovery_code" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_superseded_at" CHECK (((("status")::text <> 'superseded'::text) OR ("superseded_at" IS NOT NULL)));--> statement-breakpoint
DROP INDEX "uq_outbox_topic_event_idempotency";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "shipment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "topic" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ALTER COLUMN "dispatch_attempt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_reservations" ALTER COLUMN "shipment_line_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbox_topic_event_idempotency" ON "outbox_events" USING btree ("topic","event_type","idempotency_key");--> statement-breakpoint
ALTER TABLE "fulfillment_orders" DROP COLUMN "batch_id";--> statement-breakpoint
ALTER TABLE "outbound_batches" DROP COLUMN "assigned_to";--> statement-breakpoint
ALTER TABLE "outbound_batches" DROP COLUMN "total_items";--> statement-breakpoint
ALTER TABLE "outbound_batches" DROP COLUMN "total_qty";