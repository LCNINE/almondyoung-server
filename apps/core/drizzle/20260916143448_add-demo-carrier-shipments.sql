CREATE TABLE "demo_carrier_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"waybill_no" varchar(128) NOT NULL,
	"label_data" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'allocated' NOT NULL,
	"registered_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_demo_carrier_request_key" UNIQUE("request_key"),
	CONSTRAINT "uq_demo_carrier_waybill_no" UNIQUE("waybill_no"),
	CONSTRAINT "ck_demo_carrier_request_hash" CHECK (length("demo_carrier_shipments"."request_hash") = 64),
	CONSTRAINT "ck_demo_carrier_status" CHECK ("demo_carrier_shipments"."status" IN ('allocated', 'registered', 'canceled'))
);
