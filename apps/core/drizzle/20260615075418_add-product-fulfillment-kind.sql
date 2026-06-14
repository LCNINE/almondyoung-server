ALTER TABLE "product_master_versions"
	ADD COLUMN IF NOT EXISTS "fulfillment_kind" varchar(20) DEFAULT 'physical' NOT NULL;
