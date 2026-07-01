CREATE TYPE "public"."admin_operation_status" AS ENUM('PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "admin_operation_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "admin_operation_status" DEFAULT 'PROCESSING' NOT NULL,
	"response_json" jsonb,
	"error_json" jsonb,
	"locked_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_admin_operation_keys_op_key" ON "admin_operation_keys" USING btree ("operation","key");