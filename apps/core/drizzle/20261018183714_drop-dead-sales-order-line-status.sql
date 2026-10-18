ALTER TABLE "sales_order_lines" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "suggested_quantity";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "unavailable_sku_ids";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "deducted_at";--> statement-breakpoint
DROP TYPE "public"."order_item_status";