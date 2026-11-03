ALTER TABLE "email_verifications" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;