ALTER TYPE "public"."fulfillment_status" ADD VALUE 'unfulfillable' BEFORE 'labeled';--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD COLUMN "reservation_failure_reason" text;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD COLUMN "reservation_failure_details" jsonb;