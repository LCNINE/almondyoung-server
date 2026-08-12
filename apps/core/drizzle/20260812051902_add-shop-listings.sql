CREATE TABLE "shop_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"thumbnail_file_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unique_shop_listing_slug" ON "shop_listings" USING btree ("slug") WHERE "shop_listings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_shop_listings_active" ON "shop_listings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_shop_listings_deleted_at" ON "shop_listings" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_shop_listings_created_at" ON "shop_listings" USING btree ("created_at");