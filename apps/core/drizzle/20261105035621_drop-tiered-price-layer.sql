ALTER TABLE "pricing_rules" ALTER COLUMN "layer" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."pricing_rule_layer";--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_layer" AS ENUM('base_price', 'membership_price');--> statement-breakpoint
ALTER TABLE "pricing_rules" ALTER COLUMN "layer" SET DATA TYPE "public"."pricing_rule_layer" USING "layer"::"public"."pricing_rule_layer";--> statement-breakpoint
ALTER TABLE "pricing_rules" DROP COLUMN "min_quantity";