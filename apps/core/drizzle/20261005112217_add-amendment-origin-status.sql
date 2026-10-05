ALTER TABLE "sales_order_amendments" ADD COLUMN "origin" varchar(16) DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "source_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_superseded_by_id_sales_order_amendments_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."sales_order_amendments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_order_amendments_source_event_id" ON "sales_order_amendments" USING btree ("source_event_id") WHERE "sales_order_amendments"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sales_order_amendments_status_origin_occurred" ON "sales_order_amendments" USING btree ("status","origin","occurred_at");--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_origin_check" CHECK ("sales_order_amendments"."origin" IN ('channel', 'operator'));--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_status_check" CHECK ("sales_order_amendments"."status" IN ('applied', 'pending', 'superseded'));