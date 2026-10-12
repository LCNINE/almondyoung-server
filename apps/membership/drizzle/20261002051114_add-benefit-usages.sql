CREATE TABLE "membership_benefit_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"contract_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_benefit_usages_user_kind_period" ON "membership_benefit_usages" USING btree ("user_id","kind","period_start");--> statement-breakpoint
CREATE INDEX "idx_benefit_usages_user_used_at" ON "membership_benefit_usages" USING btree ("user_id","used_at");