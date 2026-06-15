ALTER TABLE "product_master_versions"
	DROP CONSTRAINT IF EXISTS "product_master_versions_product_code_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_active_product_code"
	ON "product_master_versions" USING btree ("product_code")
	WHERE "product_master_versions"."status" = 'active';
