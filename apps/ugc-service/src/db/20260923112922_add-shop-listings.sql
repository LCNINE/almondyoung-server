CREATE TYPE "public"."shop_listing_author_type" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."shop_listing_moderation_decider" AS ENUM('admin', 'classifier');--> statement-breakpoint
CREATE TYPE "public"."shop_listing_moderation_decision" AS ENUM('approved', 'rejected', 'pending', 'hidden', 'unhidden');--> statement-breakpoint
CREATE TYPE "public"."shop_listing_status" AS ENUM('pending', 'published', 'rejected', 'hidden', 'closed');--> statement-breakpoint
CREATE TABLE "shop_listing_images" (
	"listing_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shop_listing_images_pkey" PRIMARY KEY("listing_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "shop_listing_moderations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"decided_by" "shop_listing_moderation_decider" NOT NULL,
	"decision" "shop_listing_moderation_decision" NOT NULL,
	"label" varchar(40),
	"confidence" real,
	"reason" text,
	"actor_user_id" uuid,
	"title_snapshot" varchar(255) NOT NULL,
	"content_snapshot" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_listing_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"visitor_hash" varchar(64) NOT NULL,
	"viewed_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"region" varchar(20),
	"business_type" varchar(20),
	"deal_type" varchar(20),
	"area_pyeong" integer,
	"deposit" bigint,
	"monthly_rent" bigint,
	"key_money" bigint,
	"contact_phone" varchar(20),
	"kakao_open_chat_url" varchar(255),
	"author_type" "shop_listing_author_type" NOT NULL,
	"author_user_id" uuid,
	"status" "shop_listing_status" NOT NULL,
	"reject_reason" text,
	"submitted_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_listing_images" ADD CONSTRAINT "shop_listing_images_listing_id_shop_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."shop_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listing_moderations" ADD CONSTRAINT "shop_listing_moderations_listing_id_shop_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."shop_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listing_views" ADD CONSTRAINT "shop_listing_views_listing_id_shop_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."shop_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_listing_images_listing_order_unique" ON "shop_listing_images" USING btree ("listing_id","order");--> statement-breakpoint
CREATE INDEX "shop_listing_images_file_id" ON "shop_listing_images" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "shop_listing_moderations_listing_created" ON "shop_listing_moderations" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_listing_views_per_day_unique" ON "shop_listing_views" USING btree ("listing_id","visitor_hash","viewed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_listings_slug_unique" ON "shop_listings" USING btree ("slug") WHERE "shop_listings"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "shop_listings_status" ON "shop_listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shop_listings_author_user_id" ON "shop_listings" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "shop_listings_created_at" ON "shop_listings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shop_listings_deleted_at" ON "shop_listings" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "shop_listings_region" ON "shop_listings" USING btree ("region");--> statement-breakpoint
CREATE INDEX "shop_listings_business_type" ON "shop_listings" USING btree ("business_type");--> statement-breakpoint
CREATE INDEX "shop_listings_deal_type" ON "shop_listings" USING btree ("deal_type");