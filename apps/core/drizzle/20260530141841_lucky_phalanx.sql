CREATE TABLE "sales_order_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"amendment_kind" varchar(32) NOT NULL,
	"decision" varchar(32) DEFAULT 'approved' NOT NULL,
	"reason_code" varchar(96),
	"note" text,
	"deltas" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_amendments_kind_check" CHECK ("sales_order_amendments"."amendment_kind" IN ('commercial', 'fulfillment_only')),
	CONSTRAINT "sales_order_amendments_decision_check" CHECK ("sales_order_amendments"."decision" IN ('approved', 'rejected', 'pending')),
	CONSTRAINT "sales_order_amendments_deltas_array_check" CHECK (jsonb_typeof("sales_order_amendments"."deltas") = 'array')
);
--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sales_order_amendments_sales_order_id" ON "sales_order_amendments" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_amendments_kind" ON "sales_order_amendments" USING btree ("amendment_kind");--> statement-breakpoint
CREATE INDEX "idx_sales_order_amendments_occurred_at" ON "sales_order_amendments" USING btree ("occurred_at");