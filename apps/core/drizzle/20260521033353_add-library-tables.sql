CREATE TABLE "digital_asset_file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"release_note" text,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by" uuid
);
--> statement-breakpoint
CREATE TABLE "digital_asset_ownerships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exercised_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "digital_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"mime_type" varchar(255),
	"thumbnail_url" text,
	"current_file_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_variant_digital_asset_links" (
	"variant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "product_variant_digital_asset_links_variant_id_asset_id_pk" PRIMARY KEY("variant_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "digital_asset_file_versions" ADD CONSTRAINT "digital_asset_file_versions_asset_id_digital_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."digital_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_asset_ownerships" ADD CONSTRAINT "digital_asset_ownerships_asset_id_digital_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."digital_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_assets" ADD CONSTRAINT "digital_assets_current_file_version_id_digital_asset_file_versions_id_fk" FOREIGN KEY ("current_file_version_id") REFERENCES "public"."digital_asset_file_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_digital_asset_links" ADD CONSTRAINT "product_variant_digital_asset_links_asset_id_digital_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."digital_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dafv_asset" ON "digital_asset_file_versions" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_dafv_asset_version" ON "digital_asset_file_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "idx_dao_customer" ON "digital_asset_ownerships" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_dao_asset" ON "digital_asset_ownerships" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_dao_order" ON "digital_asset_ownerships" USING btree ("sales_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_dao_customer_asset_order" ON "digital_asset_ownerships" USING btree ("customer_id","asset_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_digital_assets_name" ON "digital_assets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_digital_assets_created_at" ON "digital_assets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_digital_assets_deleted_at" ON "digital_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_pvdal_variant" ON "product_variant_digital_asset_links" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_pvdal_asset" ON "product_variant_digital_asset_links" USING btree ("asset_id");