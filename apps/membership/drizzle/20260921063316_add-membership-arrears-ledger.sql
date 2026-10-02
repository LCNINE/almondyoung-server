CREATE TYPE "public"."membership_arrears_status" AS ENUM('OUTSTANDING', 'SETTLED', 'WAIVED');--> statement-breakpoint
CREATE TABLE "membership_arrears" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"contract_id" uuid NOT NULL,
	"invoice_ref" text NOT NULL,
	"cause" text NOT NULL,
	"cause_code" text,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'KRW' NOT NULL,
	"amount_source" text DEFAULT 'INVOICE' NOT NULL,
	"period_start" date,
	"period_end" date,
	"status" "membership_arrears_status" DEFAULT 'OUTSTANDING' NOT NULL,
	"settlement_ref" text,
	"settled_at" timestamp with time zone,
	"settled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_arrears" ADD CONSTRAINT "membership_arrears_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_membership_arrears_invoice" ON "membership_arrears" USING btree ("invoice_ref");--> statement-breakpoint
CREATE INDEX "idx_membership_arrears_user_status" ON "membership_arrears" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_membership_arrears_contract" ON "membership_arrears" USING btree ("contract_id");