ALTER TABLE "product_master_versions"
  ADD COLUMN IF NOT EXISTS "hide_membership_price_for_non_members" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "product_master_versions"
  SET "hide_membership_price_for_non_members" = "is_membership_only"
  WHERE "hide_membership_price_for_non_members" IS DISTINCT FROM "is_membership_only";
--> statement-breakpoint
ALTER TABLE "product_master_versions"
  ADD COLUMN IF NOT EXISTS "is_visible_to_members_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "product_master_versions"
  SET "is_visible_to_members_only" = true
  WHERE "master_id" IN ('ba8c971b-28d5-49bf-b5b4-f8fdc5ff8e50');
