CREATE TABLE "attendance_absence_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_minimum_wages" (
	"effective_from" date PRIMARY KEY NOT NULL,
	"hourly_wage" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_overtime_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"session_id" uuid,
	"recorded_minutes" integer NOT NULL,
	"recognized_minutes" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_pay_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pay_basis" text NOT NULL,
	"payday" integer NOT NULL,
	"period_close_day" integer NOT NULL,
	"pay_month_offset" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_pay_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"rules" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_pay_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"payday" date NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"total" integer NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text
);
--> statement-breakpoint
CREATE TABLE "attendance_wage_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hourly_wage" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"days" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_workers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"hire_date" date,
	"leave_date" date,
	"label" text,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_absence_decisions" ADD CONSTRAINT "attendance_absence_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_absence_decisions" ADD CONSTRAINT "attendance_absence_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_overtime_decisions" ADD CONSTRAINT "attendance_overtime_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_overtime_decisions" ADD CONSTRAINT "attendance_overtime_decisions_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_overtime_decisions" ADD CONSTRAINT "attendance_overtime_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_pay_policies" ADD CONSTRAINT "attendance_pay_policies_group_id_attendance_pay_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."attendance_pay_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_pay_policies" ADD CONSTRAINT "attendance_pay_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_pay_settlements" ADD CONSTRAINT "attendance_pay_settlements_group_id_attendance_pay_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."attendance_pay_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_pay_settlements" ADD CONSTRAINT "attendance_pay_settlements_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_pay_settlements" ADD CONSTRAINT "attendance_pay_settlements_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_wage_rates" ADD CONSTRAINT "attendance_wage_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_wage_rates" ADD CONSTRAINT "attendance_wage_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_work_schedules" ADD CONSTRAINT "attendance_work_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_work_schedules" ADD CONSTRAINT "attendance_work_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_workers" ADD CONSTRAINT "attendance_workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_workers" ADD CONSTRAINT "attendance_workers_group_id_attendance_pay_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."attendance_pay_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_absence_decision_daily" ON "attendance_absence_decisions" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_overtime_decision_daily" ON "attendance_overtime_decisions" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_pay_policy_effective" ON "attendance_pay_policies" USING btree ("group_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_pay_settlement_confirmed" ON "attendance_pay_settlements" USING btree ("group_id","period_start") WHERE "attendance_pay_settlements"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "attendance_pay_settlement_group" ON "attendance_pay_settlements" USING btree ("group_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_wage_rate_effective" ON "attendance_wage_rates" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_work_schedule_effective" ON "attendance_work_schedules" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX "attendance_workers_group" ON "attendance_workers" USING btree ("group_id");