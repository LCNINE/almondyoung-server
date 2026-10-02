CREATE TABLE "membership_terms_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"terms_version" text NOT NULL,
	"billing_mode" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"contract_id" uuid,
	"agreed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_terms_agreements" ADD CONSTRAINT "membership_terms_agreements_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_terms_agreements" ADD CONSTRAINT "membership_terms_agreements_contract_id_subscription_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subscription_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_membership_terms_agreements_user" ON "membership_terms_agreements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_membership_terms_agreements_contract" ON "membership_terms_agreements" USING btree ("contract_id");