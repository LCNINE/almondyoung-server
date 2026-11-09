CREATE TABLE "product_bundle_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"addon_master_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"allowed_variant_ids" uuid[],
	"regular_rate_bp" integer NOT NULL,
	"membership_rate_bp" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"label" varchar(40),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_bundle_offer_not_self" CHECK ("product_bundle_offers"."master_id" <> "product_bundle_offers"."addon_master_id"),
	CONSTRAINT "chk_bundle_offer_rates" CHECK ("product_bundle_offers"."regular_rate_bp" BETWEEN 0 AND 9900 AND "product_bundle_offers"."membership_rate_bp" BETWEEN 0 AND 9900)
);
--> statement-breakpoint
ALTER TABLE "product_bundle_offers" ADD CONSTRAINT "product_bundle_offers_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_offers" ADD CONSTRAINT "product_bundle_offers_addon_master_id_product_masters_id_fk" FOREIGN KEY ("addon_master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_bundle_offer_master_addon" ON "product_bundle_offers" USING btree ("master_id","addon_master_id");--> statement-breakpoint
CREATE INDEX "idx_bundle_offers_addon" ON "product_bundle_offers" USING btree ("addon_master_id");