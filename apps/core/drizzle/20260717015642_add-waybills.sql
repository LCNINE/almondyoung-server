CREATE TYPE "public"."waybill_source" AS ENUM('carrier', 'manual');--> statement-breakpoint
CREATE TYPE "public"."waybill_status" AS ENUM('pending', 'allocated', 'registered', 'used', 'voided', 'failed', 'abandoned');--> statement-breakpoint
CREATE TABLE "waybills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"source" "waybill_source" NOT NULL,
	"carrier" "carrier" NOT NULL,
	"status" "waybill_status" DEFAULT 'pending' NOT NULL,
	"tracking_no" varchar(128),
	"cust_ord_no" varchar(30),
	"label_data" jsonb,
	"manifest_version" integer NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_waybills_tracking_present" CHECK ("waybills"."status" NOT IN ('allocated', 'registered', 'used') OR "waybills"."tracking_no" IS NOT NULL),
	CONSTRAINT "ck_waybills_manual_status" CHECK ("waybills"."source" <> 'manual' OR "waybills"."status" IN ('registered', 'used', 'voided')),
	CONSTRAINT "ck_waybills_attempts" CHECK ("waybills"."attempts" >= 0),
	CONSTRAINT "ck_waybills_recipient_hash" CHECK (length("waybills"."recipient_hash") = 64),
	CONSTRAINT "ck_waybills_manifest_version" CHECK ("waybills"."manifest_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_waybills_shipment" ON "waybills" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_waybills_status" ON "waybills" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_waybills_tracking_no" ON "waybills" USING btree ("tracking_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_waybills_shipment_active" ON "waybills" USING btree ("shipment_id") WHERE "waybills"."status" NOT IN ('voided', 'failed', 'abandoned');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_waybills_tracking_live" ON "waybills" USING btree ("tracking_no") WHERE "waybills"."tracking_no" IS NOT NULL AND "waybills"."status" NOT IN ('voided', 'failed', 'abandoned');