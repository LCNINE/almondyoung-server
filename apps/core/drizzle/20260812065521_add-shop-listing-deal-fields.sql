ALTER TABLE "shop_listings" ADD COLUMN "business_type" varchar(20);--> statement-breakpoint
ALTER TABLE "shop_listings" ADD COLUMN "deal_type" varchar(20);--> statement-breakpoint
ALTER TABLE "shop_listings" ADD COLUMN "area_pyeong" integer;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD COLUMN "deposit" bigint;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD COLUMN "monthly_rent" bigint;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD COLUMN "key_money" bigint;--> statement-breakpoint
CREATE INDEX "idx_shop_listings_business_type" ON "shop_listings" USING btree ("business_type");--> statement-breakpoint
CREATE INDEX "idx_shop_listings_deal_type" ON "shop_listings" USING btree ("deal_type");