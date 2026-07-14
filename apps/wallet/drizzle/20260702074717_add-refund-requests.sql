CREATE TYPE "public"."refund_request_status" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELED');--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"user_id" varchar(128),
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"bank_code" varchar(8) NOT NULL,
	"bank_name" varchar(64),
	"account_number" varchar(32) NOT NULL,
	"holder_name" varchar(64) NOT NULL,
	"status" "refund_request_status" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text,
	"admin_note" text,
	"refund_id" uuid,
	"processed_by" varchar(128),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_requests_amount_positive" CHECK ("refund_requests"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refund_requests_intent_id" ON "refund_requests" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_refund_requests_status_created_at" ON "refund_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refund_requests_intent_active" ON "refund_requests" USING btree ("intent_id") WHERE "refund_requests"."status" = 'REQUESTED';