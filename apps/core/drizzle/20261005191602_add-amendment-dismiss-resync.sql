ALTER TABLE "sales_order_amendments" DROP CONSTRAINT "sales_order_amendments_status_check";--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "dismissed_by" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "dismiss_note" text;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "resync_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_status_check" CHECK ("sales_order_amendments"."status" IN ('applied', 'pending', 'superseded', 'dismissed'));