CREATE TABLE "outbound_scan_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"work_item_id" uuid,
	"shipment_status" "shipment_status" NOT NULL,
	"command_type" varchar(128) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"code" varchar(128) NOT NULL,
	"reason_code" varchar(128),
	"barcode" varchar(255),
	"sku_id" uuid,
	"quantity" integer,
	"actor_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_outbound_scan_rejection_command" UNIQUE("command_type","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "outbound_scan_rejections" ADD CONSTRAINT "outbound_scan_rejections_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_scan_rejections" ADD CONSTRAINT "outbound_scan_rejections_work_item_id_outbound_batch_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."outbound_batch_work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_scan_rejections" ADD CONSTRAINT "outbound_scan_rejections_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbound_scan_rejection_shipment" ON "outbound_scan_rejections" USING btree ("shipment_id","created_at");