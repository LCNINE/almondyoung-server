--> statement-breakpoint
-- Safely drop legacy link table if exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'inventory_master_sku_links'
  ) THEN
    DROP TABLE IF EXISTS "inventory_master_sku_links";
  END IF;
END $$;

--> statement-breakpoint
-- Drop purpose column from inventory_product_masters if exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_product_masters' AND column_name = 'purpose'
  ) THEN
    ALTER TABLE "inventory_product_masters" DROP COLUMN "purpose";
  END IF;
END $$;

--> statement-breakpoint
-- Drop enum type inventory_master_purpose if exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'inventory_master_purpose'
  ) THEN
    DROP TYPE "inventory_master_purpose";
  END IF;
END $$;


