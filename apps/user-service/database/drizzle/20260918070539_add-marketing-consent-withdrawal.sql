ALTER TABLE "user_consents" ADD COLUMN "marketing_consent_withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_consents" ADD COLUMN "marketing_consent_withdrawn_via" varchar(32);