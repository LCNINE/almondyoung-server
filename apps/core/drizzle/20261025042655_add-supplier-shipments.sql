SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE TABLE "supplier_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_supplier_handoffs_id_supplier" UNIQUE("id","supplier_id")
);
--> statement-breakpoint
ALTER TABLE "dispatch_attempts" DROP CONSTRAINT "ck_dispatch_attempts_dispatched_at";--> statement-breakpoint
ALTER TABLE "dispatch_attempts" DROP CONSTRAINT "ck_dispatch_attempts_recalled_at";--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ALTER COLUMN "holder_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "warehouse_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD COLUMN "kind" varchar(16) DEFAULT 'warehouse' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "unfulfillable_reason" text;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "unfulfillable_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "unfulfillable_reported_by" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "supplier_handoff_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_handoffs" ADD CONSTRAINT "supplier_handoffs_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_supplier_handoffs_supplier" ON "supplier_handoffs" USING btree ("supplier_id","created_at");--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "direct_ship_cancel_notices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "fk_shipments_supplier_handoff" FOREIGN KEY ("supplier_handoff_id","supplier_id") REFERENCES "public"."supplier_handoffs"("id","supplier_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_direct_ship_cancel_notices_pending_supplier" ON "direct_ship_cancel_notices" USING btree ("supplier_id","created_at") WHERE "direct_ship_cancel_notices"."notified_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_shipments_supplier_status" ON "shipments" USING btree ("supplier_id","status") WHERE "shipments"."supplier_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "direct_ship_cancel_notices" ADD CONSTRAINT "ck_direct_ship_cancel_notices_party" CHECK (("direct_ship_cancel_notices"."holder_id" IS NULL) <> ("direct_ship_cancel_notices"."supplier_id" IS NULL));--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "ck_dispatch_attempts_kind" CHECK ("dispatch_attempts"."kind" IN ('warehouse', 'supplier'));--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "ck_dispatch_attempts_supplier_no_journal" CHECK ("dispatch_attempts"."kind" <> 'supplier' OR ("dispatch_attempts"."stock_journal_id" IS NULL AND "dispatch_attempts"."reversal_journal_id" IS NULL));--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "ck_dispatch_attempts_dispatched_at" CHECK ("dispatch_attempts"."status" NOT IN ('dispatched', 'recalled') OR ("dispatch_attempts"."dispatched_at" IS NOT NULL AND ("dispatch_attempts"."kind" = 'supplier' OR "dispatch_attempts"."stock_journal_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "ck_dispatch_attempts_recalled_at" CHECK ("dispatch_attempts"."status" <> 'recalled' OR ("dispatch_attempts"."recalled_at" IS NOT NULL AND ("dispatch_attempts"."kind" = 'supplier' OR "dispatch_attempts"."reversal_journal_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "ck_shipment_lines_unfulfillable" CHECK (("shipment_lines"."unfulfillable_reason" IS NULL AND "shipment_lines"."unfulfillable_reported_at" IS NULL AND "shipment_lines"."unfulfillable_reported_by" IS NULL)
        OR ("shipment_lines"."unfulfillable_reported_at" IS NOT NULL AND "shipment_lines"."unfulfillable_reported_by" IS NOT NULL
          AND length(btrim("shipment_lines"."unfulfillable_reason")) > 0));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_owner" CHECK (("shipments"."warehouse_id" IS NULL) <> ("shipments"."supplier_id" IS NULL));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_handoff_supplier" CHECK ("shipments"."supplier_handoff_id" IS NULL OR "shipments"."supplier_id" IS NOT NULL);