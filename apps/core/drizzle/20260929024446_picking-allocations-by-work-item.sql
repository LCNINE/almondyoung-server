ALTER TABLE "picking_source_allocations" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD COLUMN "work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "picking_source_allocations_work_item_id_outbound_batch_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."outbound_batch_work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_picking_source_allocations_work_item" ON "picking_source_allocations" USING btree ("work_item_id");--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "uq_picking_source_allocations_work_item_grain" UNIQUE("work_item_id","shipment_line_id","source_location_id");