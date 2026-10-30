CREATE TYPE "public"."tenant_status" AS ENUM('preparing', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"host" varchar(255) PRIMARY KEY NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"user_id" uuid NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"status" "tenant_status" DEFAULT 'preparing' NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "iam_audit_logs" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "pii_access_logs" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_domains_tenant_id_idx" ON "tenant_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_memberships_tenant_id_idx" ON "tenant_memberships" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;