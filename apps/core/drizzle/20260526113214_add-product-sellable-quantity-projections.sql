CREATE TABLE "product_sellable_quantity_projections" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid,
	"version_id" uuid,
	"matching_id" uuid,
	"sellable_quantity" integer DEFAULT 0 NOT NULL,
	"stock_bound_quantity" integer DEFAULT 0 NOT NULL,
	"is_sellable" boolean DEFAULT false NOT NULL,
	"reason" varchar(64) NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_product_sellable_qty_sellable" ON "product_sellable_quantity_projections" USING btree ("is_sellable");--> statement-breakpoint
CREATE INDEX "idx_product_sellable_qty_updated_at" ON "product_sellable_quantity_projections" USING btree ("updated_at");