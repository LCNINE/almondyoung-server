ALTER TABLE "tenant_memberships" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tenant_memberships" CASCADE;--> statement-breakpoint
ALTER TABLE "business_licenses" DROP CONSTRAINT "business_licenses_business_number_unique";--> statement-breakpoint
ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_provider_provider_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_login_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
DROP INDEX "email_verifications_email_idx";--> statement-breakpoint
DROP INDEX "phone_verifications_phone_number_idx";--> statement-breakpoint
ALTER TABLE "business_licenses" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_verifications" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verifications" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_identities" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_account_tenant_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_account_tenant_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verifications_tenant_id_email_idx" ON "email_verifications" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "phone_verifications_tenant_id_phone_number_idx" ON "phone_verifications" USING btree ("tenant_id","phone_number");--> statement-breakpoint
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_tenant_id_business_number_unique" UNIQUE("tenant_id","business_number");--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_tenant_id_provider_provider_id_unique" UNIQUE("tenant_id","provider","provider_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_login_id_unique" UNIQUE("tenant_id","login_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_email_unique" UNIQUE("tenant_id","email");