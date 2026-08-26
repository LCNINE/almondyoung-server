CREATE TABLE "payment_fee_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method_type" "payment_method_type" NOT NULL,
	"fee_rate_bp" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_fee_rates_bp_range" CHECK ("payment_fee_rates"."fee_rate_bp" >= 0 AND "payment_fee_rates"."fee_rate_bp" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_fee_rates_method_effective" ON "payment_fee_rates" USING btree ("method_type","effective_from");