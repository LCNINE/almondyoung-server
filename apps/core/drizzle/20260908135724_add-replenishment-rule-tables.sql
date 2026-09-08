CREATE TYPE "public"."replenishment_override_mode" AS ENUM('auto', 'excluded');--> statement-breakpoint
CREATE TABLE "replenishment_grade_rules" (
	"grade" "demand_grade" PRIMARY KEY NOT NULL,
	"alpha" double precision NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishment_route_rules" (
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"lead_time_days" double precision NOT NULL,
	"lead_time_std_days" double precision,
	"cover_days" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replenishment_route_rules_from_warehouse_id_to_warehouse_id_pk" PRIMARY KEY("from_warehouse_id","to_warehouse_id"),
	CONSTRAINT "ck_replenishment_route_rules_distinct" CHECK ("replenishment_route_rules"."from_warehouse_id" <> "replenishment_route_rules"."to_warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "replenishment_sku_overrides" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"mode" "replenishment_override_mode" DEFAULT 'auto' NOT NULL,
	"excluded_until" date,
	"safety_stock" integer,
	"alpha" double precision,
	"memo" varchar(255),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_replenishment_sku_overrides_alpha" CHECK ("replenishment_sku_overrides"."alpha" IS NULL OR ("replenishment_sku_overrides"."alpha" > 0 AND "replenishment_sku_overrides"."alpha" < 1)),
	CONSTRAINT "ck_replenishment_sku_overrides_safety_stock" CHECK ("replenishment_sku_overrides"."safety_stock" IS NULL OR "replenishment_sku_overrides"."safety_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "replenishment_supplier_rules" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"lead_time_days" double precision NOT NULL,
	"lead_time_std_days" double precision,
	"cover_days" integer NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replenishment_route_rules" ADD CONSTRAINT "replenishment_route_rules_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_route_rules" ADD CONSTRAINT "replenishment_route_rules_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_sku_overrides" ADD CONSTRAINT "replenishment_sku_overrides_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_supplier_rules" ADD CONSTRAINT "replenishment_supplier_rules_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_replenishment_sku_overrides_mode" ON "replenishment_sku_overrides" USING btree ("mode");