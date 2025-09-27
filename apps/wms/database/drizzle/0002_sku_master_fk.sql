--> statement-breakpoint
-- Ensure a default master exists to backfill existing SKUs
INSERT INTO "inventory_product_masters" ("id","name","master_code","status")
VALUES ('00000000-0000-0000-0000-000000000001','Default Master','DEFAULT-MASTER','active')
ON CONFLICT ("master_code") DO NOTHING;

--> statement-breakpoint
-- Add master_id and option_key columns to skus
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "master_id" uuid;
ALTER TABLE "skus" ADD COLUMN IF NOT EXISTS "option_key" jsonb;

--> statement-breakpoint
-- Backfill null master_id with default master
UPDATE "skus" SET "master_id" = '00000000-0000-0000-0000-000000000001' WHERE "master_id" IS NULL;

--> statement-breakpoint
-- Enforce NOT NULL and add FK
ALTER TABLE "skus" ALTER COLUMN "master_id" SET NOT NULL;
ALTER TABLE "skus" ADD CONSTRAINT IF NOT EXISTS "skus_master_id_fkey"
  FOREIGN KEY ("master_id") REFERENCES "inventory_product_masters"("id") ON DELETE RESTRICT;

--> statement-breakpoint
-- Unique constraint to prevent duplicate option combinations per master
ALTER TABLE "skus" ADD CONSTRAINT IF NOT EXISTS "skus_master_id_option_key_unique" UNIQUE ("master_id","option_key");


