CREATE TYPE "public"."customer_return_pickup_status" AS ENUM('pending', 'reserved', 'failed', 'void', 'cancel_pending', 'cancelled');--> statement-breakpoint
CREATE TABLE "customer_return_pickups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_return_id" uuid NOT NULL,
	"carrier" "carrier" NOT NULL,
	"cust_ord_no" varchar(30) NOT NULL,
	"status" "customer_return_pickup_status" DEFAULT 'pending' NOT NULL,
	"waybill_no" varchar(32),
	"original_waybill_no" varchar(32),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"reserved_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_return_pickups_cust_ord_no_unique" UNIQUE("cust_ord_no")
);
--> statement-breakpoint
ALTER TABLE "customer_return_pickups" ADD CONSTRAINT "customer_return_pickups_customer_return_id_customer_returns_id_fk" FOREIGN KEY ("customer_return_id") REFERENCES "public"."customer_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_return_pickups_active" ON "customer_return_pickups" USING btree ("customer_return_id") WHERE "customer_return_pickups"."status" IN ('pending', 'reserved', 'cancel_pending');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_return_pickups_waybill" ON "customer_return_pickups" USING btree ("waybill_no") WHERE "customer_return_pickups"."waybill_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_customer_return_pickups_due" ON "customer_return_pickups" USING btree ("status","next_attempt_at");