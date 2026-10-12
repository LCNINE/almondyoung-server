CREATE TYPE "public"."refund_execution" AS ENUM('AUTO', 'MANUAL');--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "execution" "refund_execution" DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_code" varchar(128);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_retryable" boolean;