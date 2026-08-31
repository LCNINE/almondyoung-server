CREATE TABLE "setting_operating_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monthly_fixed_cost" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"memo" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_setting_operating_costs_effective" ON "setting_operating_costs" USING btree ("effective_from");