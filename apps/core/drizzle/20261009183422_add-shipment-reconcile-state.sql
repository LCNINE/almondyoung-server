CREATE TABLE "shipment_reconcile_state" (
	"rule" varchar(64) NOT NULL,
	"shipment_id" uuid NOT NULL,
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
	CONSTRAINT "shipment_reconcile_state_rule_shipment_id_pk" PRIMARY KEY("rule","shipment_id")
);
--> statement-breakpoint
ALTER TABLE "shipment_reconcile_state" ADD CONSTRAINT "shipment_reconcile_state_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shipment_reconcile_state_gave_up" ON "shipment_reconcile_state" USING btree ("shipment_id") WHERE "shipment_reconcile_state"."gave_up_at" IS NOT NULL;