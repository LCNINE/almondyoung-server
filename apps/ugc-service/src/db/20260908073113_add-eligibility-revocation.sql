ALTER TABLE "review_eligibilities" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "review_eligibilities" ADD COLUMN "revoke_reason" varchar(40);