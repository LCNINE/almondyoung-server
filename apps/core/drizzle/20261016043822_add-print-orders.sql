CREATE TABLE "print_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"sales_order_line_id" uuid NOT NULL,
	"almond_design_id" uuid NOT NULL,
	"vendor" varchar(16) DEFAULT 'wowpress' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"test_memo" boolean DEFAULT false NOT NULL,
	"vendor_order_number" varchar(64),
	"vendor_box_number" varchar(32),
	"vendor_shipping_fee" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitting_at" timestamp with time zone,
	"order_attempted_at" timestamp with time zone,
	"carrier" varchar(16),
	"tracking_number" varchar(64),
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"test_confirmed_at" timestamp with time zone,
	"test_confirmed_by" uuid,
	"test_note" text,
	"cancel_refused_at" timestamp with time zone,
	"cancel_resolved_at" timestamp with time zone,
	"cancel_resolved_by" uuid,
	"sales_cancel_failed_at" timestamp with time zone,
	"file_delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_print_orders_sales_order_line" UNIQUE("sales_order_line_id")
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "almond_design_id" uuid;--> statement-breakpoint
CREATE INDEX "ix_print_orders_sales_order" ON "print_orders" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_print_orders_status_next_attempt" ON "print_orders" USING btree ("status","next_attempt_at");