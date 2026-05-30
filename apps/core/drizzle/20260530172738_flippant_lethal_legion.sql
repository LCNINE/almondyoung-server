CREATE TABLE "sales_order_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"cancellation_scope" varchar(32) DEFAULT 'full' NOT NULL,
	"status" varchar(32) DEFAULT 'applied' NOT NULL,
	"reason_code" varchar(96),
	"reason_detail" text,
	"cancelled_by" varchar(128),
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_cancellations_scope_check" CHECK ("sales_order_cancellations"."cancellation_scope" IN ('full', 'partial')),
	CONSTRAINT "sales_order_cancellations_status_check" CHECK ("sales_order_cancellations"."status" IN ('applied')),
	CONSTRAINT "sales_order_cancellations_effects_array_check" CHECK (jsonb_typeof("sales_order_cancellations"."effects") = 'array')
);
--> statement-breakpoint
ALTER TABLE "sales_order_cancellations" ADD CONSTRAINT "sales_order_cancellations_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sales_order_cancellations_sales_order_id" ON "sales_order_cancellations" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_cancellations_scope" ON "sales_order_cancellations" USING btree ("cancellation_scope");--> statement-breakpoint
CREATE INDEX "idx_sales_order_cancellations_occurred_at" ON "sales_order_cancellations" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sales_order_full_cancellation" ON "sales_order_cancellations" USING btree ("sales_order_id") WHERE "sales_order_cancellations"."cancellation_scope" = 'full';