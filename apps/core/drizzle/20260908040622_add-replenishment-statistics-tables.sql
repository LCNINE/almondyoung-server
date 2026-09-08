CREATE TYPE "public"."demand_grade" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."demand_pattern" AS ENUM('smooth', 'intermittent', 'erratic', 'lumpy', 'insufficient', 'none');--> statement-breakpoint
CREATE TYPE "public"."demand_source" AS ENUM('sellmate', 'core');--> statement-breakpoint
CREATE TABLE "replenishment_settings" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"adi_threshold" double precision DEFAULT 1.32 NOT NULL,
	"cv2_threshold" double precision DEFAULT 0.49 NOT NULL,
	"classification_window_days" integer DEFAULT 365 NOT NULL,
	"param_window_days_frequent" integer DEFAULT 90 NOT NULL,
	"param_window_days_sparse" integer DEFAULT 365 NOT NULL,
	"min_demand_events" integer DEFAULT 3 NOT NULL,
	"min_lead_time_observations" integer DEFAULT 5 NOT NULL,
	"lead_time_window_days" integer DEFAULT 365 NOT NULL,
	"grade_a_cut" double precision DEFAULT 0.8 NOT NULL,
	"grade_b_cut" double precision DEFAULT 0.95 NOT NULL,
	"demand_core_since" date,
	"demand_recompute_days" integer DEFAULT 14 NOT NULL,
	"consolidation_buffer_days" integer DEFAULT 7 NOT NULL,
	"default_lead_time_days" double precision DEFAULT 30 NOT NULL,
	"default_lead_time_std_days" double precision,
	"default_transfer_lead_time_days" double precision DEFAULT 14 NOT NULL,
	"default_transfer_lead_time_std_days" double precision,
	"default_lead_time_cv" double precision DEFAULT 0.25 NOT NULL,
	"default_cover_days" integer DEFAULT 30 NOT NULL,
	"default_transfer_cover_days" integer DEFAULT 14 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_lead_time_profiles" (
	"from_warehouse_id" uuid NOT NULL,
	"to_warehouse_id" uuid NOT NULL,
	"observations" integer NOT NULL,
	"mean_days" double precision NOT NULL,
	"std_days" double precision,
	"window_from" date NOT NULL,
	"window_to" date NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_lead_time_profiles_from_warehouse_id_to_warehouse_id_pk" PRIMARY KEY("from_warehouse_id","to_warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "sku_demand_daily" (
	"sku_id" uuid NOT NULL,
	"demand_date" date NOT NULL,
	"qty" integer NOT NULL,
	"amount" bigint,
	"source" "demand_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_demand_daily_sku_id_demand_date_pk" PRIMARY KEY("sku_id","demand_date"),
	CONSTRAINT "chk_sku_demand_daily_qty" CHECK ("sku_demand_daily"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sku_demand_profiles" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"pattern" "demand_pattern" NOT NULL,
	"grade" "demand_grade" NOT NULL,
	"adi" double precision,
	"cv2" double precision,
	"daily_mean" double precision DEFAULT 0 NOT NULL,
	"daily_std" double precision DEFAULT 0 NOT NULL,
	"daily_mean_90" double precision DEFAULT 0 NOT NULL,
	"size_mean" double precision,
	"size_std" double precision,
	"interval_mean" double precision,
	"history_days" integer DEFAULT 0 NOT NULL,
	"demand_events" integer DEFAULT 0 NOT NULL,
	"classification_from" date NOT NULL,
	"classification_to" date NOT NULL,
	"param_from" date NOT NULL,
	"param_to" date NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_lead_time_profiles" (
	"supplier_id" uuid PRIMARY KEY NOT NULL,
	"observations" integer NOT NULL,
	"mean_days" double precision NOT NULL,
	"std_days" double precision,
	"window_from" date NOT NULL,
	"window_to" date NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_lead_time_profiles" ADD CONSTRAINT "route_lead_time_profiles_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_lead_time_profiles" ADD CONSTRAINT "route_lead_time_profiles_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_demand_daily" ADD CONSTRAINT "sku_demand_daily_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_demand_profiles" ADD CONSTRAINT "sku_demand_profiles_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_lead_time_profiles" ADD CONSTRAINT "supplier_lead_time_profiles_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sku_demand_daily_date" ON "sku_demand_daily" USING btree ("demand_date");--> statement-breakpoint
CREATE INDEX "idx_sku_demand_profiles_pattern" ON "sku_demand_profiles" USING btree ("pattern");