CREATE TABLE "print_product_specs" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"prodno" integer NOT NULL,
	"jobpresetno" text NOT NULL,
	"prsjob" jsonb NOT NULL,
	"awkjob" jsonb NOT NULL,
	"qty_per_unit" integer NOT NULL,
	"file_format" text NOT NULL,
	"file_dpi" integer NOT NULL,
	"design_product_id" varchar(36) NOT NULL,
	"design_width_mm" integer NOT NULL,
	"design_height_mm" integer NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_template_products" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
