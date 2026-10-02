CREATE TABLE "setting_revenue_goal_months" (
	"goal_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"target" bigint NOT NULL,
	CONSTRAINT "setting_revenue_goal_months_goal_id_month_pk" PRIMARY KEY("goal_id","month")
);
--> statement-breakpoint
CREATE TABLE "setting_revenue_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"scope" varchar(20) DEFAULT 'own_mall' NOT NULL,
	"annual_target" bigint NOT NULL,
	"pre_coverage_actual" bigint,
	"plan_assumptions" jsonb,
	"memo" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "setting_revenue_goal_months" ADD CONSTRAINT "setting_revenue_goal_months_goal_id_setting_revenue_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."setting_revenue_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_setting_revenue_goals_year_created" ON "setting_revenue_goals" USING btree ("year","created_at");