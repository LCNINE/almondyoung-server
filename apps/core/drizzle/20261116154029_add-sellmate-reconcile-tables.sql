CREATE TABLE "sellmate_handed_over_orders" (
	"sales_order_id" uuid PRIMARY KEY NOT NULL,
	"display_id" integer NOT NULL,
	"medusa_order_id" varchar(64) NOT NULL,
	"run_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellmate_item_pairs" (
	"option_serial" varchar(64) PRIMARY KEY NOT NULL,
	"product_serial" varchar(64) NOT NULL,
	"item_name" text NOT NULL,
	"barcode" varchar(128),
	"sku_id" uuid,
	"matched_by" varchar(16),
	"unpaired_reason" varchar(32),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellmate_reconcile_items" (
	"run_id" uuid NOT NULL,
	"option_serial" varchar(64) NOT NULL,
	"sku_id" uuid NOT NULL,
	"sellmate_current" integer NOT NULL,
	"sellmate_unshipped" integer NOT NULL,
	"s" integer NOT NULL,
	"baseline_before" integer NOT NULL,
	"carry_before" integer NOT NULL,
	"delta" integer NOT NULL,
	"carry_after" integer NOT NULL,
	"upload_avail" integer,
	"uploaded_current" integer,
	"ref_unshipped" integer,
	"close_verdict" varchar(32),
	"accept" varchar(16),
	CONSTRAINT "sellmate_reconcile_items_run_id_option_serial_pk" PRIMARY KEY("run_id","option_serial")
);
--> statement-breakpoint
CREATE TABLE "sellmate_reconcile_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(24) NOT NULL,
	"input_sha256" char(64) NOT NULL,
	"input_snapshot_at" timestamp with time zone NOT NULL,
	"cutover_at" timestamp with time zone,
	"upload_file" text,
	"close_input_sha256" char(64),
	"close_snapshot_at" timestamp with time zone,
	"accepted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "sellmate_reconcile_runs_input_sha256_unique" UNIQUE("input_sha256")
);
--> statement-breakpoint
CREATE TABLE "sellmate_reconcile_states" (
	"sku_id" uuid PRIMARY KEY NOT NULL,
	"option_serial" varchar(64) NOT NULL,
	"baseline" integer NOT NULL,
	"carry" integer NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"last_run_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellmate_reconcile_states_option_serial_unique" UNIQUE("option_serial"),
	CONSTRAINT "ck_sellmate_reconcile_states_carry_nonneg" CHECK ("sellmate_reconcile_states"."carry" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sellmate_handed_over_orders" ADD CONSTRAINT "sellmate_handed_over_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellmate_handed_over_orders" ADD CONSTRAINT "sellmate_handed_over_orders_run_id_sellmate_reconcile_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sellmate_reconcile_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellmate_item_pairs" ADD CONSTRAINT "sellmate_item_pairs_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellmate_reconcile_items" ADD CONSTRAINT "sellmate_reconcile_items_run_id_sellmate_reconcile_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sellmate_reconcile_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellmate_reconcile_states" ADD CONSTRAINT "sellmate_reconcile_states_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellmate_reconcile_states" ADD CONSTRAINT "sellmate_reconcile_states_last_run_id_sellmate_reconcile_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."sellmate_reconcile_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sellmate_reconcile_runs_init" ON "sellmate_reconcile_runs" USING btree ("kind") WHERE "sellmate_reconcile_runs"."kind" = 'init';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sellmate_reconcile_runs_awaiting_close" ON "sellmate_reconcile_runs" USING btree ("status") WHERE "sellmate_reconcile_runs"."status" = 'awaiting_close';