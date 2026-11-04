ALTER TABLE "business_licenses" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "user_identities" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;