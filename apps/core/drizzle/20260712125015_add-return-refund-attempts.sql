CREATE TYPE "public"."return_refund_attempt_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "return_refund_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_request_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "return_refund_attempt_status" DEFAULT 'pending' NOT NULL,
	"wallet_outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_return_refund_attempt_number" UNIQUE("return_request_id","attempt_number")
);
--> statement-breakpoint
ALTER TABLE "return_refund_attempts" ADD CONSTRAINT "return_refund_attempts_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_return_refund_attempt_pending" ON "return_refund_attempts" USING btree ("return_request_id") WHERE "return_refund_attempts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_return_refund_attempts_request" ON "return_refund_attempts" USING btree ("return_request_id");