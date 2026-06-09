CREATE TABLE "product_master_purchase_constraints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"purchase_constraint_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_purchase_constraints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requires_membership" boolean DEFAULT false NOT NULL,
	"lifetime_quantity_limit" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_product_purchase_constraints_lifetime_quantity_limit_positive" CHECK ("lifetime_quantity_limit" IS NULL OR "lifetime_quantity_limit" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_master_purchase_constraints" ADD CONSTRAINT "product_master_purchase_constraints_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_purchase_constraints" ADD CONSTRAINT "product_master_purchase_constraints_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_purchase_constraints" ADD CONSTRAINT "product_master_purchase_constraints_purchase_constraint_id_product_purchase_constraints_id_fk" FOREIGN KEY ("purchase_constraint_id") REFERENCES "public"."product_purchase_constraints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_master_purchase_constraints_master_version" ON "product_master_purchase_constraints" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_master_purchase_constraints_constraint" ON "product_master_purchase_constraints" USING btree ("purchase_constraint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_purchase_constraint_version" ON "product_master_purchase_constraints" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_purchase_constraint_version" ON "product_master_purchase_constraints" USING btree ("master_id","version_id");