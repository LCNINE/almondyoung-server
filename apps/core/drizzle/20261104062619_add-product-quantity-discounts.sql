CREATE TABLE "product_master_quantity_discounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"quantity_discount_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_quantity_discounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"tiers" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variant_price_cache" ADD COLUMN "membership_tiered_prices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "product_master_quantity_discounts" ADD CONSTRAINT "product_master_quantity_discounts_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_quantity_discounts" ADD CONSTRAINT "product_master_quantity_discounts_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_quantity_discounts" ADD CONSTRAINT "product_master_quantity_discounts_quantity_discount_id_product_quantity_discounts_id_fk" FOREIGN KEY ("quantity_discount_id") REFERENCES "public"."product_quantity_discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_master_quantity_discounts_discount" ON "product_master_quantity_discounts" USING btree ("quantity_discount_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_quantity_discount_version" ON "product_master_quantity_discounts" USING btree ("master_id","version_id");