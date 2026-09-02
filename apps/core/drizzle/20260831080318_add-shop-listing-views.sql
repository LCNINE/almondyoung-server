CREATE TABLE "shop_listing_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"viewed_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_shop_listing_view_per_day" ON "shop_listing_views" USING btree ("listing_id","visitor_hash","viewed_on");--> statement-breakpoint
CREATE INDEX "idx_shop_listing_views_listing_day" ON "shop_listing_views" USING btree ("listing_id","viewed_on");