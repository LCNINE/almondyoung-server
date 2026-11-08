ALTER TABLE "pii_access_logs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ALTER COLUMN "app" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "tenant_id" SET NOT NULL;