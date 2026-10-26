ALTER TABLE "direct_ship_cancel_notices" DROP CONSTRAINT "ck_direct_ship_cancel_notices_party";--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" DROP CONSTRAINT "direct_ship_cancel_notices_holder_id_holders_id_fk";
--> statement-breakpoint
UPDATE "delivery_profiles" SET "supported_fulfillment_modes" = array_remove("supported_fulfillment_modes"::text[], 'drop_ship')::"public"."fulfillment_mode"[] WHERE 'drop_ship' = ANY("supported_fulfillment_modes"::text[]);--> statement-breakpoint
ALTER TABLE "delivery_profiles" ALTER COLUMN "supported_fulfillment_modes" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "fulfillment_mode" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."fulfillment_mode";--> statement-breakpoint
CREATE TYPE "public"."fulfillment_mode" AS ENUM('in_house', '3pl');--> statement-breakpoint
ALTER TABLE "delivery_profiles" ALTER COLUMN "supported_fulfillment_modes" SET DATA TYPE "public"."fulfillment_mode"[] USING "supported_fulfillment_modes"::"public"."fulfillment_mode"[];--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ALTER COLUMN "fulfillment_mode" SET DATA TYPE "public"."fulfillment_mode" USING "fulfillment_mode"::"public"."fulfillment_mode";--> statement-breakpoint
DROP INDEX "idx_direct_ship_cancel_notices_pending";--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ALTER COLUMN "supplier_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" DROP COLUMN "holder_id";--> statement-breakpoint
ALTER TABLE "fulfillment_orders" DROP COLUMN "direct_ship_status";--> statement-breakpoint
DROP TYPE "public"."direct_ship_status";