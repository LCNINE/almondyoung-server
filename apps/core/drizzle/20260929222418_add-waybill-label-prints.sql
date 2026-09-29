CREATE TABLE "waybill_label_prints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"revision" integer NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"printed_by" uuid NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_waybill_label_prints_shipment_fingerprint" UNIQUE("shipment_id","fingerprint"),
	CONSTRAINT "uq_waybill_label_prints_shipment_revision" UNIQUE("shipment_id","revision"),
	CONSTRAINT "ck_waybill_label_prints_revision" CHECK ("waybill_label_prints"."revision" >= 1),
	CONSTRAINT "ck_waybill_label_prints_fingerprint" CHECK (length("waybill_label_prints"."fingerprint") = 64)
);
--> statement-breakpoint
ALTER TABLE "waybill_label_prints" ADD CONSTRAINT "waybill_label_prints_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;