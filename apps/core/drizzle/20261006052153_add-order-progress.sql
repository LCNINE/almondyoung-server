CREATE TABLE "order_progress" (
	"sales_order_id" uuid PRIMARY KEY NOT NULL,
	"sales_channel" "sales_channel" NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"stage" varchar(32),
	"state" varchar(64),
	"stage_entered_at" timestamp with time zone NOT NULL,
	"outcome" varchar(32),
	"closed_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_progress" ADD CONSTRAINT "order_progress_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_order_progress_open_stage" ON "order_progress" USING btree ("stage","stage_entered_at") WHERE "order_progress"."outcome" IS NULL;