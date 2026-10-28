SET LOCAL lock_timeout = '10s';--> statement-breakpoint
DROP TABLE "exchange_request_items" CASCADE;--> statement-breakpoint
DROP TABLE "exchange_requests" CASCADE;--> statement-breakpoint
DROP TABLE "return_items" CASCADE;--> statement-breakpoint
DROP TABLE "return_refund_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "return_request_items" CASCADE;--> statement-breakpoint
DROP TABLE "return_requests" CASCADE;--> statement-breakpoint
DROP TABLE "returns" CASCADE;--> statement-breakpoint
DROP TYPE "public"."exchange_reason_code";--> statement-breakpoint
DROP TYPE "public"."exchange_request_status";--> statement-breakpoint
DROP TYPE "public"."return_reason_code";--> statement-breakpoint
DROP TYPE "public"."return_refund_attempt_status";--> statement-breakpoint
DROP TYPE "public"."return_request_status";--> statement-breakpoint
DROP TYPE "public"."return_status";