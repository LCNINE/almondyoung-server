CREATE TABLE "inventory_idempotency_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inv_idem_requests_endpoint_key" ON "inventory_idempotency_requests" USING btree ("endpoint","key");--> statement-breakpoint
CREATE INDEX "idx_inv_idem_requests_created_at" ON "inventory_idempotency_requests" USING btree ("created_at");