ALTER TABLE "inbound_receipt_lines" DROP CONSTRAINT "inbound_receipt_lines_plan_item_id_inbound_plan_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_work_logs" DROP CONSTRAINT "inbound_work_logs_plan_item_id_inbound_plan_items_id_fk";
--> statement-breakpoint
DROP TABLE "inbound_plan_items" RESTRICT;--> statement-breakpoint
DROP TABLE "inbound_plans" RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" DROP COLUMN "plan_item_id" RESTRICT;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" DROP COLUMN "plan_item_id" RESTRICT;--> statement-breakpoint
DROP TYPE "public"."plan_type" RESTRICT;
