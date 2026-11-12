ALTER TYPE "public"."shipment_operation_type" ADD VALUE 'force_dispatch' BEFORE 'amend';--> statement-breakpoint
ALTER TABLE "shipment_operations" ALTER COLUMN "reason" SET DATA TYPE varchar(500);--> statement-breakpoint
ALTER TABLE "shipment_operations" ADD COLUMN "reason_code" varchar(64);--> statement-breakpoint
ALTER TABLE "shipment_operations" ADD COLUMN "request_channel" varchar(32);