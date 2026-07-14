CREATE TYPE "public"."email_verification_purpose" AS ENUM('phone_verify', 'password_change');--> statement-breakpoint
ALTER TYPE "public"."phone_verification_purpose" ADD VALUE 'password_change';--> statement-breakpoint
CREATE TABLE "email_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"code" varchar(6) NOT NULL,
	"purpose" "email_verification_purpose" NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"is_expired" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_verifications_email_idx" ON "email_verifications" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_verifications_purpose_idx" ON "email_verifications" USING btree ("purpose");