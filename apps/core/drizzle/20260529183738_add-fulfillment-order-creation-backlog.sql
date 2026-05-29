CREATE TYPE "public"."fulfillment_order_creation_backlog_status" AS ENUM('pending', 'processing', 'awaiting_matching', 'completed', 'not_required', 'failed');--> statement-breakpoint
CREATE TABLE "fulfillment_order_creation_backlogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"fulfillment_order_id" uuid,
	"status" "fulfillment_order_creation_backlog_status" DEFAULT 'pending' NOT NULL,
	"waiting_variant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" varchar(128),
	"failure_details" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_order_creation_backlogs_sales_order_id_unique" UNIQUE("sales_order_id")
);
--> statement-breakpoint
ALTER TABLE "fulfillment_order_creation_backlogs" ADD CONSTRAINT "fulfillment_order_creation_backlogs_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_creation_backlogs" ADD CONSTRAINT "fulfillment_order_creation_backlogs_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fo_creation_backlogs_status_next_attempt" ON "fulfillment_order_creation_backlogs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_fo_creation_backlogs_fulfillment_order" ON "fulfillment_order_creation_backlogs" USING btree ("fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "idx_fo_creation_backlogs_waiting_variant_ids" ON "fulfillment_order_creation_backlogs" USING gin ("waiting_variant_ids");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_variant" ON "sales_order_lines" USING btree ("variant_id");