CREATE TYPE "public"."cash_receipt_status" AS ENUM('ISSUED', 'CANCELED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."cash_receipt_type" AS ENUM('소득공제', '지출증빙');--> statement-breakpoint
CREATE TABLE "cash_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"user_id" varchar(128),
	"type" "cash_receipt_type" NOT NULL,
	"customer_identity_number" varchar(30) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "cash_receipt_status" NOT NULL,
	"canceled_amount" integer DEFAULT 0 NOT NULL,
	"receipt_key" varchar(200),
	"issue_number" varchar(9),
	"receipt_url" text,
	"error_code" varchar(128),
	"error_message" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"issued_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_receipts_amount_positive" CHECK ("cash_receipts"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_receipts" ADD CONSTRAINT "cash_receipts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cash_receipts_active_charge" ON "cash_receipts" USING btree ("charge_id") WHERE "cash_receipts"."status" = 'ISSUED';--> statement-breakpoint
CREATE INDEX "idx_cash_receipts_intent" ON "cash_receipts" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_cash_receipts_user_created_at" ON "cash_receipts" USING btree ("user_id","created_at");