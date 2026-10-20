CREATE TABLE "iam_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp (3) DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_login_id" varchar(30),
	"action" varchar(50) NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_label" varchar(100) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(45),
	"user_agent" text,
	"request_id" varchar(100)
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "landing_path" varchar(200);--> statement-breakpoint
CREATE INDEX "iam_audit_logs_occurred_at_idx" ON "iam_audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "iam_audit_logs_target_idx" ON "iam_audit_logs" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "iam_audit_logs_actor_idx" ON "iam_audit_logs" USING btree ("actor_user_id","occurred_at");