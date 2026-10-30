ALTER TABLE "oauth_clients" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;