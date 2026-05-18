CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "agg_product_order_daily" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agg_date" date NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"sales_channel" varchar(50) NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agg_user_product_purchase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" varchar(255) NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"channel_product_id" varchar(255),
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"last_purchased_at" timestamp,
	"first_purchased_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dim_product_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"category_id" varchar(255) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dim_product_masters" (
	"master_id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text,
	"active_version_id" varchar(255),
	"is_active" boolean,
	"last_change_reason" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	"last_event_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dim_product_variants" (
	"variant_id" varchar(255) PRIMARY KEY NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"version_id" varchar(255) NOT NULL,
	"variant_name" text,
	"is_default" boolean,
	"status" varchar(20),
	"inventory_management" boolean,
	"pre_stock_sellable" boolean,
	"always_sellable_zero_stock" boolean,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp,
	"last_event_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fact_order_events" (
	"message_id" varchar(26) PRIMARY KEY NOT NULL,
	"message_type" varchar(100) NOT NULL,
	"message_version" integer DEFAULT 1 NOT NULL,
	"message_kind" varchar(20) NOT NULL,
	"correlation_id" varchar(26) NOT NULL,
	"causation_id" varchar(26),
	"aggregate_type" varchar(50),
	"aggregate_id" varchar(255),
	"source_service" varchar(100),
	"sales_channel" varchar(50),
	"order_id" varchar(255),
	"external_order_id" varchar(255),
	"occurred_at" timestamp,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fact_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" varchar(26) NOT NULL,
	"order_key" varchar(255) NOT NULL,
	"order_id" varchar(255),
	"external_order_id" varchar(255),
	"sales_channel" varchar(50) NOT NULL,
	"customer_id" varchar(255),
	"order_item_id" varchar(255) NOT NULL,
	"master_id" varchar(255) NOT NULL,
	"version_id" varchar(255),
	"variant_id" varchar(255),
	"sku_id" varchar(255),
	"product_name" text,
	"channel_product_id" varchar(255),
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"total_price" integer,
	"currency" varchar(10),
	"occurred_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event"."outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(100) NOT NULL,
	"aggregate_type" varchar(50) NOT NULL,
	"aggregate_id" varchar(100) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp,
	"failed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "event"."event_resource_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"event_id" varchar(26) NOT NULL,
	"chain_id" varchar(36) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"action" varchar(50),
	"description" text,
	"service_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."role_scope_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_name" varchar(100) NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" varchar(50),
	"description" text,
	"microservice_name" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agg_product_order_daily" ON "agg_product_order_daily" USING btree ("agg_date","master_id","sales_channel");--> statement-breakpoint
CREATE INDEX "idx_agg_product_order_daily_date" ON "agg_product_order_daily" USING btree ("agg_date");--> statement-breakpoint
CREATE INDEX "idx_agg_product_order_daily_master" ON "agg_product_order_daily" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_agg_product_order_daily_channel" ON "agg_product_order_daily" USING btree ("sales_channel");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agg_user_product" ON "agg_user_product_purchase" USING btree ("customer_id","master_id");--> statement-breakpoint
CREATE INDEX "idx_agg_user_product_customer" ON "agg_user_product_purchase" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_agg_user_product_master" ON "agg_user_product_purchase" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_agg_user_product_count" ON "agg_user_product_purchase" USING btree ("purchase_count");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dim_product_categories_master_category" ON "dim_product_categories" USING btree ("master_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_dim_product_categories_master" ON "dim_product_categories" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_dim_product_categories_category" ON "dim_product_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_dim_product_categories_primary" ON "dim_product_categories" USING btree ("is_primary");--> statement-breakpoint
CREATE INDEX "idx_dim_product_masters_active" ON "dim_product_masters" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_dim_product_masters_name" ON "dim_product_masters" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_dim_product_masters_updated_at" ON "dim_product_masters" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_dim_product_variants_master" ON "dim_product_variants" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_dim_product_variants_status" ON "dim_product_variants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dim_product_variants_updated_at" ON "dim_product_variants" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_fact_order_events_type" ON "fact_order_events" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX "idx_fact_order_events_occurred_at" ON "fact_order_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_fact_order_events_order" ON "fact_order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_fact_order_events_external_order" ON "fact_order_events" USING btree ("external_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fact_order_items_order_item" ON "fact_order_items" USING btree ("order_key","sales_channel","order_item_id");--> statement-breakpoint
CREATE INDEX "idx_fact_order_items_master" ON "fact_order_items" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_fact_order_items_occurred_at" ON "fact_order_items" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_fact_order_items_order_key" ON "fact_order_items" USING btree ("order_key");--> statement-breakpoint
CREATE INDEX "idx_fact_order_items_customer" ON "fact_order_items" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");