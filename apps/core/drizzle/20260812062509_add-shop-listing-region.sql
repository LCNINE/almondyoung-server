ALTER TABLE "shop_listings" ADD COLUMN "region" varchar(20);--> statement-breakpoint
CREATE INDEX "idx_shop_listings_region" ON "shop_listings" USING btree ("region");