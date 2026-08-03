CREATE TABLE "agg_channel_daily" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agg_date" date NOT NULL,
	"sales_channel" varchar(50) NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"gross_revenue" bigint DEFAULT 0 NOT NULL,
	"cancelled_amount" bigint DEFAULT 0 NOT NULL,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agg_customer_lifetime" (
	"customer_id" varchar(255) PRIMARY KEY NOT NULL,
	"first_order_at" timestamp,
	"last_order_at" timestamp,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"total_revenue" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agg_membership_daily" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agg_date" date NOT NULL,
	"status" varchar(30) NOT NULL,
	"tier_id" varchar(255) DEFAULT 'UNKNOWN' NOT NULL,
	"members_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agg_variant_order_daily" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agg_date" date NOT NULL,
	"variant_id" varchar(255) NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"sales_channel" varchar(50) NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"gross_revenue" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dim_customer_membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"tier_id" varchar(255) DEFAULT 'UNKNOWN' NOT NULL,
	"contract_id" varchar(255),
	"valid_from" timestamp NOT NULL,
	"valid_to" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fact_membership_events" (
	"message_id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" varchar(30) NOT NULL,
	"tier_id" varchar(255),
	"plan_id" varchar(255),
	"contract_id" varchar(255),
	"reason_code" varchar(100),
	"reason_text" text,
	"occurred_at" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agg_product_order_daily" ADD COLUMN "gross_revenue" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agg_product_order_daily" ADD COLUMN "cancelled_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agg_product_order_daily" ADD COLUMN "refunded_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agg_channel_daily" ON "agg_channel_daily" USING btree ("agg_date","sales_channel");--> statement-breakpoint
CREATE INDEX "idx_agg_channel_daily_date" ON "agg_channel_daily" USING btree ("agg_date");--> statement-breakpoint
CREATE INDEX "idx_agg_customer_lifetime_first_order" ON "agg_customer_lifetime" USING btree ("first_order_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agg_membership_daily" ON "agg_membership_daily" USING btree ("agg_date","status","tier_id");--> statement-breakpoint
CREATE INDEX "idx_agg_membership_daily_date" ON "agg_membership_daily" USING btree ("agg_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agg_variant_order_daily" ON "agg_variant_order_daily" USING btree ("agg_date","variant_id","sales_channel");--> statement-breakpoint
CREATE INDEX "idx_agg_variant_order_daily_date" ON "agg_variant_order_daily" USING btree ("agg_date");--> statement-breakpoint
CREATE INDEX "idx_agg_variant_order_daily_master" ON "agg_variant_order_daily" USING btree ("master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dim_customer_membership" ON "dim_customer_membership" USING btree ("user_id","valid_from");--> statement-breakpoint
CREATE INDEX "idx_dim_customer_membership_user" ON "dim_customer_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_dim_customer_membership_valid_to" ON "dim_customer_membership" USING btree ("valid_to");--> statement-breakpoint
CREATE INDEX "idx_fact_membership_events_user" ON "fact_membership_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_fact_membership_events_occurred_at" ON "fact_membership_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_fact_membership_events_status" ON "fact_membership_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fact_membership_events_reason" ON "fact_membership_events" USING btree ("reason_code");