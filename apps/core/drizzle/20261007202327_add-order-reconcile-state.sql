CREATE TABLE "order_reconcile_state" (
	"rule" varchar(64) NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"tracking_row" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"mode" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_result" varchar(16) NOT NULL,
	"last_error" text,
	"next_check_at" timestamp with time zone NOT NULL,
	"gave_up_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_reconcile_state_rule_sales_order_id_pk" PRIMARY KEY("rule","sales_order_id")
);
--> statement-breakpoint
ALTER TABLE "order_reconcile_state" ADD CONSTRAINT "order_reconcile_state_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_order_reconcile_state_rule_next_check" ON "order_reconcile_state" USING btree ("rule","next_check_at");--> statement-breakpoint
CREATE INDEX "idx_order_reconcile_state_gave_up" ON "order_reconcile_state" USING btree ("sales_order_id") WHERE "order_reconcile_state"."gave_up_at" IS NOT NULL;