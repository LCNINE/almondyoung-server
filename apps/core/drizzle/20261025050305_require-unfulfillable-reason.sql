SET LOCAL lock_timeout = '10s';--> statement-breakpoint
ALTER TABLE "shipment_lines" DROP CONSTRAINT "ck_shipment_lines_unfulfillable";--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "ck_shipment_lines_unfulfillable" CHECK (("shipment_lines"."unfulfillable_reason" IS NULL AND "shipment_lines"."unfulfillable_reported_at" IS NULL AND "shipment_lines"."unfulfillable_reported_by" IS NULL)
        OR ("shipment_lines"."unfulfillable_reported_at" IS NOT NULL AND "shipment_lines"."unfulfillable_reported_by" IS NOT NULL
          AND "shipment_lines"."unfulfillable_reason" IS NOT NULL AND length(btrim("shipment_lines"."unfulfillable_reason")) > 0));