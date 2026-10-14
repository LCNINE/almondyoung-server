SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" DROP CONSTRAINT "fulfillment_order_items_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_product_matching_id_product_matchings_id_fk";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT "sales_order_lines_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk";--> statement-breakpoint
DROP INDEX "idx_sales_order_lines_snapshot";--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" DROP COLUMN "mapping_snapshot_id";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "product_matching_id";--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP COLUMN "mapping_snapshot_id";--> statement-breakpoint
DROP TABLE "product_sku_mapping_snapshots";
