CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."product_master_version_approval_status" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."product_master_version_status" AS ENUM('draft', 'inactive', 'active');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_layer" AS ENUM('base_price', 'membership_price', 'tiered_price');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_operation_type" AS ENUM('offset', 'scale', 'override');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_scope_type" AS ENUM('all_variants', 'with_option', 'variants');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('USER_LOGIN', 'USER_LOGOUT', 'USER_ACTION', 'STOCK_CREATED', 'STOCK_UPDATED', 'STOCK_DELETED', 'STOCK_RESERVED', 'STOCK_UNRESERVED', 'STOCK_MOVED', 'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_MERGED', 'FULFILLMENT_CREATED', 'FULFILLMENT_READY', 'FULFILLMENT_SHIPPED', 'SKU_CREATED', 'SKU_UPDATED', 'SKU_DELETED', 'PRODUCT_MATCHED', 'PRODUCT_MATCHING_RESOLVED', 'SYSTEM_STARTUP', 'SYSTEM_ERROR', 'SYSTEM_WARNING', 'CONFIG_CHANGED', 'POLICY_CHANGED');--> statement-breakpoint
CREATE TYPE "public"."audit_severity" AS ENUM('INFO', 'WARN', 'ERROR', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('created', 'picking', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."carrier" AS ENUM('CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS');--> statement-breakpoint
CREATE TYPE "public"."direct_ship_status" AS ENUM('pending', 'forwarded', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('PENDING', 'POSTED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('IN', 'IN_DOMESTIC', 'IN_OVERSEAS', 'IN_RETURN', 'OUT', 'OUT_ORDER', 'OUT_DAMAGE', 'OUT_LOSS', 'OUT_DISPOSAL', 'MOVE', 'MOVE_INTER_WAREHOUSE', 'MOVE_INTRA_WAREHOUSE', 'ADJUST', 'ADJUST_MANUAL', 'ADJUST_INVENTORY', 'RESERVE', 'CONFIRM', 'RELEASE', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."event_type_order" AS ENUM('ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_MODIFIED', 'ORDER_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_mode" AS ENUM('in_house', '3pl', 'drop_ship');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('created', 'reserving', 'ready', 'labeled', 'shipped', 'canceled', 'pending', 'allocated', 'picking', 'picked', 'inspecting', 'invoiced', 'completed', 'forwarded');--> statement-breakpoint
CREATE TYPE "public"."inbound_method" AS ENUM('individual', 'simple', 'simple_fullscan', 'planned');--> statement-breakpoint
CREATE TYPE "public"."inbound_receipt_status" AS ENUM('posted', 'voided');--> statement-breakpoint
CREATE TYPE "public"."inbound_status" AS ENUM('pending', 'applied', 'receiving', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."inbound_work_type" AS ENUM('INBOUND', 'PUTAWAY', 'RETURN', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."invoice_method" AS ENUM('goodsflow', 'direct', 'self');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('issued', 'printed', 'shipped', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('standard', 'zone');--> statement-breakpoint
CREATE TYPE "public"."matching_priority" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."matching_status" AS ENUM('pending', 'matched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."matching_strategy" AS ENUM('void', 'variant');--> statement-breakpoint
CREATE TYPE "public"."order_item_status" AS ENUM('pending', 'matched', 'stock_deducted', 'stock_unavailable', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."picking_method" AS ENUM('individual', 'total_picking');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('source', 'destination');--> statement-breakpoint
CREATE TYPE "public"."po_audit_status" AS ENUM('draft', 'pending_audit', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('created', 'confirmed', 'received');--> statement-breakpoint
CREATE TYPE "public"."po_type" AS ENUM('domestic', 'foreign');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending', 'confirmed', 'released', 'active');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('requested', 'received', 'qc_passed', 'qc_failed', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('medusa', 'naver', 'coupang', '3pl');--> statement-breakpoint
CREATE TYPE "public"."setting_key" AS ENUM('use_sub_barcode', 'use_expiry_separation');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('created', 'in_transit', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('direct', 'in_house', 'overseas');--> statement-breakpoint
CREATE TYPE "public"."stock_state" AS ENUM('ON_HAND', 'DEFECTIVE', 'IN_TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."stock_type" AS ENUM('physical', 'infinite', 'drop_shipped', 'consignment');--> statement-breakpoint
CREATE TYPE "public"."stocktaking_status" AS ENUM('draft', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."system_location_role" AS ENUM('inbound_default', 'return_default');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('created', 'picking', 'packed', 'shipped', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."transition_type" AS ENUM('RECEIVE', 'SHIP', 'MOVE', 'MARK_DEFECT', 'REWORK_GOOD', 'SCRAP', 'ADJUST_UP', 'ADJUST_DOWN');--> statement-breakpoint
CREATE TYPE "public"."unavailable_reason" AS ENUM('pb', 'foreign', 'low_margin');--> statement-breakpoint
CREATE TYPE "public"."warehouse_type" AS ENUM('domestic', 'overseas', 'bonded', 'return');--> statement-breakpoint
CREATE TABLE "banner_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"pc_width" integer,
	"pc_height" integer,
	"mobile_width" integer,
	"mobile_height" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "banner_groups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"banner_group_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"pc_image_file_id" uuid NOT NULL,
	"mobile_image_file_id" uuid NOT NULL,
	"link_url" text,
	"linked_product_master_ids" jsonb DEFAULT '[]'::jsonb,
	"display_start_at" timestamp,
	"display_end_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "category_tag_groups" (
	"category_id" uuid NOT NULL,
	"tag_group_id" uuid NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"applies_to_descendants" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_tag_groups_category_id_tag_group_id_pk" PRIMARY KEY("category_id","tag_group_id")
);
--> statement-breakpoint
CREATE TABLE "channel_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"channel_specific_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_variant_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"sales_channel_id" uuid NOT NULL,
	"channel_item_id" varchar(255) NOT NULL,
	"channel_item_name" varchar(500),
	"channel_option_name" varchar(255),
	"channel_price" bigint,
	"channel_product_url" varchar(1000),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"badge" varchar(30),
	"is_pinned" boolean DEFAULT false NOT NULL,
	"display_start_at" timestamp,
	"display_end_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"layer" "pricing_rule_layer" NOT NULL,
	"order" integer NOT NULL,
	"scope_type" "pricing_rule_scope_type" NOT NULL,
	"scope_target_ids" uuid[],
	"operation_type" "pricing_rule_operation_type" NOT NULL,
	"operation_value" bigint NOT NULL,
	"min_quantity" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_approval_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"comment" text,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"changes" jsonb,
	"user_id" uuid NOT NULL,
	"user_email" varchar(255),
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"slug" varchar(255) NOT NULL,
	"image_url" text,
	"parent_id" uuid,
	"level" integer DEFAULT 0 NOT NULL,
	"path" varchar(1000) DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"visibility" boolean DEFAULT true NOT NULL,
	"display_settings" jsonb,
	"seo_config" jsonb,
	"template_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "product_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_master_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_master_option_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"option_group_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_master_pricing_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"pricing_rule_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_master_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_master_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"master_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_version_id" uuid,
	"status" "product_master_version_status" DEFAULT 'draft' NOT NULL,
	"draft_owner_id" uuid,
	"name" varchar(255) DEFAULT '새 상품' NOT NULL,
	"description" text,
	"brand" varchar(100),
	"thumbnail" text,
	"seo_title" varchar(255),
	"seo_description" text,
	"seo_keywords" text[],
	"description_html" text,
	"is_wholesale_only" boolean DEFAULT false NOT NULL,
	"is_membership_only" boolean DEFAULT false NOT NULL,
	"product_type" varchar(50) DEFAULT 'regular_sale' NOT NULL,
	"product_code" varchar(100),
	"alternative_name" varchar(255),
	"material" text,
	"sales_classification" varchar(100),
	"purchase_classification" varchar(100),
	"shipping_method_id" uuid,
	"market_price" bigint,
	"supply_price" bigint,
	"supplier_id" uuid,
	"age_restriction" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_quantity" integer,
	"sales_start_date" timestamp,
	"sales_end_date" timestamp,
	"approval_status" "product_master_version_approval_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by" uuid,
	"rejection_reason" text,
	"deleted_at" timestamp,
	"deleted_by" uuid,
	"seller" varchar(100),
	"registration_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "product_master_versions_product_code_unique" UNIQUE("product_code")
);
--> statement-breakpoint
CREATE TABLE "product_masters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_option_group_displays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"option_group_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"locale" varchar(10) DEFAULT 'ko-KR' NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_value_displays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"option_value_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"locale" varchar(10) DEFAULT 'ko-KR' NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"color_code" varchar(7),
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"option_group_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_tag_values" (
	"master_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"tag_value_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_tag_values_master_id_version_id_tag_value_id_pk" PRIMARY KEY("master_id","version_id","tag_value_id")
);
--> statement-breakpoint
CREATE TABLE "product_variant_price_cache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"base_price" bigint NOT NULL,
	"membership_price" bigint NOT NULL,
	"tiered_prices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_name" varchar(255),
	"image_id" uuid,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"variant_code" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"promotion_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"variant_id" uuid
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"discount_type" varchar(20) NOT NULL,
	"discount_value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" varchar(50) DEFAULT 'ONLINE' NOT NULL,
	"site" varchar(50) NOT NULL,
	"category_id" uuid,
	"name" varchar(100) NOT NULL,
	"description" text,
	"config" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"api_endpoint" varchar(500),
	"credentials" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_option_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"severity" "audit_severity" DEFAULT 'INFO' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" varchar(255),
	"user_agent" text,
	"ip_address" varchar(45),
	"resource_type" varchar(100),
	"resource_id" varchar(255),
	"resource_name" text,
	"changes_before" jsonb,
	"changes_after" jsonb,
	"action" varchar(100) NOT NULL,
	"module" varchar(50) NOT NULL,
	"description" text,
	"metadata" jsonb,
	"error_message" text,
	"stack_trace" text,
	"correlation_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"source_type" "source_type" NOT NULL,
	"avg_delivery_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_order_batches" (
	"fulfillment_order_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"remove_reason" varchar(255),
	CONSTRAINT "fulfillment_order_batches_fulfillment_order_id_batch_id_pk" PRIMARY KEY("fulfillment_order_id","batch_id")
);
--> statement-breakpoint
CREATE TABLE "fulfillment_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_order_id" uuid NOT NULL,
	"sales_order_id" varchar(255),
	"sales_order_line_id" varchar(255),
	"mapping_snapshot_id" uuid,
	"variant_id" uuid,
	"sku_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"reserved_qty" integer DEFAULT 0 NOT NULL,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"shipped_qty" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reserved_qty" integer DEFAULT 0 NOT NULL,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"shipped_qty" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid,
	"warehouse_id" uuid,
	"owner_id" uuid,
	"status" "fulfillment_status" DEFAULT 'created' NOT NULL,
	"direct_ship_status" "direct_ship_status",
	"batch_id" uuid,
	"fulfillment_mode" "fulfillment_mode",
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"total_reserved_qty" integer DEFAULT 0 NOT NULL,
	"allocated_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"shipping_address" json,
	"label_no" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_our_asset" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp NOT NULL,
	"name" varchar(128) NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"source" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"expected_qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expected_date" timestamp,
	"warehouse_id" uuid NOT NULL,
	"plan_type" "plan_type" DEFAULT 'destination' NOT NULL,
	"parent_plan_id" uuid,
	"linked_purchase_order_id" uuid NOT NULL,
	"destination_warehouse_id" uuid NOT NULL,
	"requires_transfer" boolean DEFAULT false NOT NULL,
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"origin_location_id" uuid,
	"event_id" uuid,
	"memo" varchar(255),
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"canceled_qty" integer DEFAULT 0 NOT NULL,
	"putaway_from_origin_qty" integer DEFAULT 0 NOT NULL,
	"plan_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" "inbound_method" NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" "inbound_receipt_status" DEFAULT 'posted' NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_work_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "inbound_work_type" NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid,
	"line_id" uuid,
	"plan_item_id" uuid,
	"sku_id" uuid,
	"warehouse_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity" integer,
	"method" "inbound_method",
	"reason" varchar(255),
	"event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_order_id" uuid NOT NULL,
	"invoice_number" varchar(128) NOT NULL,
	"carrier_code" varchar(32),
	"issue_method" "invoice_method" NOT NULL,
	"goodsflow_service_id" varchar(255),
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "location_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"column_name" varchar(10) NOT NULL,
	"display_order" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_columns_warehouse_id_column_name_unique" UNIQUE("warehouse_id","column_name")
);
--> statement-breakpoint
CREATE TABLE "location_racks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"column_id" uuid NOT NULL,
	"rack_number" integer NOT NULL,
	"default_bin_start" integer DEFAULT 1 NOT NULL,
	"default_bin_end" integer DEFAULT 20 NOT NULL,
	"auto_generate_bins" boolean DEFAULT true NOT NULL,
	"physical_width" integer,
	"physical_height" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_racks_column_id_rack_number_unique" UNIQUE("column_id","rack_number")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"location_type" "location_type" NOT NULL,
	"rack_id" uuid,
	"bin_identifier" varchar(20),
	"display_name" varchar(128),
	"capacity_limit" integer,
	"fifo_rank" integer,
	"is_expiry_separated" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_role" "system_location_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_warehouse_id_code_unique" UNIQUE("warehouse_id","code"),
	CONSTRAINT "locations_warehouse_id_system_role_unique" UNIQUE("warehouse_id","system_role"),
	CONSTRAINT "ck_locations_type" CHECK ((
        (location_type = 'standard' AND rack_id IS NOT NULL AND bin_identifier IS NOT NULL)
        OR 
        (location_type = 'zone' AND rack_id IS NULL AND bin_identifier IS NULL)
    )),
	CONSTRAINT "ck_locations_system_role" CHECK (( (is_system = true AND system_role IS NOT NULL) OR (is_system = false AND system_role IS NULL) )),
	CONSTRAINT "ck_locations_system_zone" CHECK (( is_system = false OR location_type = 'zone' ))
);
--> statement-breakpoint
CREATE TABLE "merge_groups" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"shipping_address_hash" varchar(64) NOT NULL,
	"total_shipping_fee" integer DEFAULT 0 NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"event_id" uuid,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"journal_id" uuid,
	"actor_id" uuid,
	"memo" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_work_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(32) DEFAULT 'MOVE' NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid,
	"line_id" uuid,
	"sku_id" uuid,
	"warehouse_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity" integer,
	"event_id" uuid,
	"reason" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"order_id" uuid NOT NULL,
	"event_type" "event_type_order" NOT NULL,
	"payload" json NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_number" varchar(64) NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "batch_status" DEFAULT 'created' NOT NULL,
	"picking_method" "picking_method" NOT NULL,
	"cart_capacity" integer,
	"assigned_to" varchar(255),
	"name" varchar(255),
	"total_items" integer DEFAULT 0 NOT NULL,
	"total_qty" integer DEFAULT 0 NOT NULL,
	"scheduled_picking_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbound_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE "outbound_task_items" (
	"task_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity_pending" integer DEFAULT 0 NOT NULL,
	"quantity_picking" integer DEFAULT 0 NOT NULL,
	"quantity_picked" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_task_items_task_id_sku_id_pk" PRIMARY KEY("task_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_task_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"location_id" uuid,
	"scanned_barcode" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_task_orders" (
	"task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_task_orders_task_id_order_id_pk" PRIMARY KEY("task_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "outbound_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"merge_group_id" varchar(64),
	"status" "task_status" DEFAULT 'created' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"total_quantity" integer DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"requires_gift_wrap" boolean DEFAULT false NOT NULL,
	"temperature_controlled" boolean DEFAULT false NOT NULL,
	"unavailable_reason" "unavailable_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"partition_key" varchar(128) NOT NULL,
	"payload" json NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_matchings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"master_id" uuid,
	"sku_group_id" uuid,
	"status" "matching_status" DEFAULT 'pending' NOT NULL,
	"priority" "matching_priority" DEFAULT 'normal' NOT NULL,
	"strategy" "matching_strategy",
	"is_resolved" boolean DEFAULT false NOT NULL,
	"inventory_management" boolean DEFAULT false NOT NULL,
	"pre_stock_sellable" boolean DEFAULT true NOT NULL,
	"always_sellable_zero_stock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_matchings_variant_id_unique" UNIQUE("variant_id")
);
--> statement-breakpoint
CREATE TABLE "product_sku_mapping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_per_product" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sku_mapping_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar(255) NOT NULL,
	"source_version" integer NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"snapshot_data" json NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku_id" uuid,
	"quantity" integer NOT NULL,
	"mapping_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sku_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" varchar(255) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variant_sku_links" (
	"product_matching_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variant_sku_links_product_matching_id_sku_id_pk" PRIMARY KEY("product_matching_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"type" "po_type" NOT NULL,
	"supplier_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"po_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_po_id_sku_id_pk" PRIMARY KEY("po_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "po_type" NOT NULL,
	"supplier_id" uuid,
	"expected_arrival" timestamp,
	"status" "po_status" DEFAULT 'created' NOT NULL,
	"source_warehouse_id" uuid NOT NULL,
	"destination_warehouse_id" uuid NOT NULL,
	"requires_transfer" boolean DEFAULT false NOT NULL,
	"audit_status" "po_audit_status" DEFAULT 'draft' NOT NULL,
	"submitted_for_audit_at" timestamp with time zone,
	"submitted_for_audit_by" uuid,
	"audited_at" timestamp with time zone,
	"audited_by" uuid,
	"audit_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"requested_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"qc_passed_quantity" integer DEFAULT 0 NOT NULL,
	"qc_failed_quantity" integer DEFAULT 0 NOT NULL,
	"restocked_quantity" integer DEFAULT 0 NOT NULL,
	"disposed_quantity" integer DEFAULT 0 NOT NULL,
	"location_id" uuid,
	"qc_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"qc_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"shipment_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"status" "return_status" DEFAULT 'requested' NOT NULL,
	"return_reason" varchar(500),
	"qc_inspected_at" timestamp with time zone,
	"qc_inspected_by" varchar(128),
	"qc_notes" text,
	"restock_quantity" integer DEFAULT 0 NOT NULL,
	"dispose_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_matching_id" uuid,
	"mapping_snapshot_id" uuid,
	"product_name" varchar(255) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer,
	"total_price" integer,
	"status" "order_item_status" DEFAULT 'pending' NOT NULL,
	"suggested_quantity" integer,
	"unavailable_sku_ids" json,
	"deducted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_order_id" varchar(255) NOT NULL,
	"sales_channel" "sales_channel" NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"customer_name" varchar(255),
	"customer_email" varchar(255),
	"customer_phone" varchar(50),
	"shipping_address" json NOT NULL,
	"shipping_address_hash" varchar(64),
	"total_amount" integer,
	"shipping_fee" integer DEFAULT 0 NOT NULL,
	"merge_group_id" varchar(64),
	"is_merged" boolean DEFAULT false NOT NULL,
	"memo" text,
	"order_date" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_sales_channel_channel_order_id_unique" UNIQUE("sales_channel","channel_order_id")
);
--> statement-breakpoint
CREATE TABLE "sales_variant_policies" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"inventory_management" boolean DEFAULT false NOT NULL,
	"pre_stock_sellable" boolean DEFAULT false NOT NULL,
	"always_sellable_zero_stock" boolean DEFAULT false NOT NULL,
	"fulfillment_mode" "fulfillment_mode",
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"key" "setting_key" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"location" varchar(255),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_no" varchar(64) NOT NULL,
	"carrier" "carrier" DEFAULT 'CJ' NOT NULL,
	"status" "shipment_status" DEFAULT 'created' NOT NULL,
	"eta" timestamp with time zone,
	"split_status" boolean DEFAULT false NOT NULL,
	"invoice_url" varchar(512),
	"fulfillment_order_id" uuid,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"barcode" varchar(64) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"packing_unit" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_barcodes_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "sku_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_groups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sku_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_location_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"barcode" varchar(64) NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"quantity" integer,
	"reason" text,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"moved_by" uuid,
	"movement_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"designer_id" uuid,
	"purchase_manager_id" uuid,
	"registration_manager_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_managers_sku_id_unique" UNIQUE("sku_id")
);
--> statement-breakpoint
CREATE TABLE "sku_suppliers" (
	"sku_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_sku" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_suppliers_sku_id_supplier_id_pk" PRIMARY KEY("sku_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_id" uuid DEFAULT '019d0001-0000-7000-a000-000000000001' NOT NULL,
	"group_id" uuid,
	"option_key" varchar(255),
	"name" varchar(255) NOT NULL,
	"code" varchar(64) NOT NULL,
	"stock_type" "stock_type" DEFAULT 'physical' NOT NULL,
	"delivery_profile_id" uuid,
	"sale_1m" integer,
	"sale_3m" integer,
	"safety_stock" integer DEFAULT 0 NOT NULL,
	"business_product_name" varchar(255),
	"import_declaration_number" varchar(100),
	"logistics_partner_id" uuid,
	"discount" varchar(100),
	"manufacturer_star" varchar(100),
	"product_weight" integer,
	"dimension_width" integer,
	"dimension_height" integer,
	"dimension_depth" integer,
	"product_material" text,
	"korean_name" varchar(255),
	"max_discount_quantity" integer,
	"packaging_importer_name" varchar(255),
	"product_description" text,
	"moq" integer,
	"memo2" text,
	"memo3" text,
	"main_image_url" varchar(512),
	"expiry_date_management" boolean DEFAULT false NOT NULL,
	"expiry_start_date" timestamp with time zone,
	"expiry_end_date" timestamp with time zone,
	"manufacturing_date_management" boolean DEFAULT false NOT NULL,
	"is_general_inventory" boolean DEFAULT true NOT NULL,
	"validity_start_date" timestamp with time zone,
	"validity_end_date" timestamp with time zone,
	"primary_location_id" uuid,
	"secondary_location_id" uuid,
	"variant_group_code" varchar(64),
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid,
	"sku_id" uuid NOT NULL,
	"from_warehouse_id" uuid,
	"from_location_id" uuid,
	"to_warehouse_id" uuid,
	"to_location_id" uuid,
	"from_state" "stock_state",
	"to_state" "stock_state",
	"transition_type" "transition_type" NOT NULL,
	"quantity" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" varchar(128),
	"event_status" "event_status" DEFAULT 'POSTED' NOT NULL,
	"reversal_of_event_id" uuid,
	"voided_by_event_id" uuid,
	"reason" varchar(255),
	CONSTRAINT "stock_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_events_qty_positive" CHECK ("stock_events"."quantity" > 0),
	CONSTRAINT "ck_events_states_diff" CHECK (("stock_events"."from_state" is distinct from "stock_events"."to_state") 
          OR ("stock_events"."from_location_id" is distinct from "stock_events"."to_location_id")
          OR ("stock_events"."from_warehouse_id" is distinct from "stock_events"."to_warehouse_id")),
	CONSTRAINT "ck_events_side_present" CHECK (("stock_events"."from_state" is not null) or ("stock_events"."to_state" is not null)),
	CONSTRAINT "ck_events_fromloc_has_wh" CHECK (("stock_events"."from_location_id" is null) or ("stock_events"."from_warehouse_id" is not null)),
	CONSTRAINT "ck_events_toloc_has_wh" CHECK (("stock_events"."to_location_id" is null) or ("stock_events"."to_warehouse_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(64),
	"source_id" uuid,
	"idempotency_key" varchar(128),
	"actor_id" uuid,
	CONSTRAINT "stock_journals_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "stock_ledgers" (
	"sku_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"stock_state" "stock_state" NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_ledgers_sku_id_warehouse_id_location_id_stock_state_pk" PRIMARY KEY("sku_id","warehouse_id","location_id","stock_state"),
	CONSTRAINT "ck_ledgers_non_negative" CHECK ("stock_ledgers"."qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(50) NOT NULL,
	"target_id" uuid NOT NULL,
	"fulfillment_order_item_id" uuid,
	"sku_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'pending' NOT NULL,
	"timeout_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktaking_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"stock_event_id" uuid,
	"adjustment_quantity" integer NOT NULL,
	"adjustment_type" varchar(20) NOT NULL,
	"reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stocktaking_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"location_id" uuid,
	"expected_quantity" integer NOT NULL,
	"counted_quantity" integer,
	"variance" integer,
	"scanned_barcode" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"counted_at" timestamp with time zone,
	"counted_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stocktaking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"session_name" varchar(255) NOT NULL,
	"status" "stocktaking_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"started_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "supplier_category_mappings" (
	"supplier_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_category_mappings_supplier_id_category_id_pk" PRIMARY KEY("supplier_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"fax" varchar(50),
	"email" varchar(255),
	"zipcode" varchar(20),
	"address1" varchar(500),
	"address2" varchar(500),
	"business_reg_no" varchar(50),
	"business_type" varchar(100),
	"ceo_name" varchar(100),
	"code" varchar(50),
	"is_direct_delivery" boolean DEFAULT false NOT NULL,
	"order_cutoff_time" varchar(10),
	"bank_name" varchar(100),
	"bank_account_no" varchar(100),
	"bank_account_holder" varchar(100),
	"payment_method" varchar(50),
	"description" text,
	"memo" text,
	"purchase_manager_id" varchar(36),
	"default_warehouse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "warehouse_type" DEFAULT 'domestic' NOT NULL,
	"location" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
ALTER TABLE "banners" ADD CONSTRAINT "banners_banner_group_id_banner_groups_id_fk" FOREIGN KEY ("banner_group_id") REFERENCES "public"."banner_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_tag_groups" ADD CONSTRAINT "category_tag_groups_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_tag_groups" ADD CONSTRAINT "category_tag_groups_tag_group_id_tag_groups_id_fk" FOREIGN KEY ("tag_group_id") REFERENCES "public"."tag_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_products" ADD CONSTRAINT "channel_products_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_products" ADD CONSTRAINT "channel_products_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_variant_listings" ADD CONSTRAINT "channel_variant_listings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_variant_listings" ADD CONSTRAINT "channel_variant_listings_sales_channel_id_sales_channels_id_fk" FOREIGN KEY ("sales_channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_approval_history" ADD CONSTRAINT "product_approval_history_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_product_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."product_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_categories" ADD CONSTRAINT "product_master_categories_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_categories" ADD CONSTRAINT "product_master_categories_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_categories" ADD CONSTRAINT "product_master_categories_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_option_groups" ADD CONSTRAINT "product_master_option_groups_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_option_groups" ADD CONSTRAINT "product_master_option_groups_option_group_id_product_option_groups_id_fk" FOREIGN KEY ("option_group_id") REFERENCES "public"."product_option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_option_groups" ADD CONSTRAINT "product_master_option_groups_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_pricing_rules" ADD CONSTRAINT "product_master_pricing_rules_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_pricing_rules" ADD CONSTRAINT "product_master_pricing_rules_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_pricing_rules" ADD CONSTRAINT "product_master_pricing_rules_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_variants" ADD CONSTRAINT "product_master_variants_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_variants" ADD CONSTRAINT "product_master_variants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_variants" ADD CONSTRAINT "product_master_variants_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_versions" ADD CONSTRAINT "product_master_versions_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_master_versions" ADD CONSTRAINT "product_master_versions_parent_version_id_product_master_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_group_displays" ADD CONSTRAINT "product_option_group_displays_option_group_id_product_option_groups_id_fk" FOREIGN KEY ("option_group_id") REFERENCES "public"."product_option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_group_displays" ADD CONSTRAINT "product_option_group_displays_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_group_displays" ADD CONSTRAINT "product_option_group_displays_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_displays" ADD CONSTRAINT "product_option_value_displays_option_value_id_product_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_displays" ADD CONSTRAINT "product_option_value_displays_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_value_displays" ADD CONSTRAINT "product_option_value_displays_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_group_id_product_option_groups_id_fk" FOREIGN KEY ("option_group_id") REFERENCES "public"."product_option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tag_values" ADD CONSTRAINT "product_tag_values_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tag_values" ADD CONSTRAINT "product_tag_values_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_tag_values" ADD CONSTRAINT "product_tag_values_tag_value_id_tag_values_id_fk" FOREIGN KEY ("tag_value_id") REFERENCES "public"."tag_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_price_cache" ADD CONSTRAINT "product_variant_price_cache_version_id_product_master_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."product_master_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_price_cache" ADD CONSTRAINT "product_variant_price_cache_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_master_id_product_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."product_masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD CONSTRAINT "sales_channels_category_id_channel_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."channel_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_values" ADD CONSTRAINT "tag_values_group_id_tag_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tag_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_option_value_id_product_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_values"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_batches" ADD CONSTRAINT "fulfillment_order_batches_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_batches" ADD CONSTRAINT "fulfillment_order_batches_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "fulfillment_order_items_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "fulfillment_order_items_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk" FOREIGN KEY ("mapping_snapshot_id") REFERENCES "public"."product_sku_mapping_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "fulfillment_order_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_lines" ADD CONSTRAINT "fulfillment_order_lines_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_order_lines" ADD CONSTRAINT "fulfillment_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_owner_id_holders_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."holders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD CONSTRAINT "inbound_plan_items_plan_id_inbound_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."inbound_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plan_items" ADD CONSTRAINT "inbound_plan_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plans" ADD CONSTRAINT "inbound_plans_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plans" ADD CONSTRAINT "inbound_plans_parent_plan_id_inbound_plans_id_fk" FOREIGN KEY ("parent_plan_id") REFERENCES "public"."inbound_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plans" ADD CONSTRAINT "inbound_plans_linked_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("linked_purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_plans" ADD CONSTRAINT "inbound_plans_destination_warehouse_id_warehouses_id_fk" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_receipt_id_inbound_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_origin_location_id_locations_id_fk" FOREIGN KEY ("origin_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD CONSTRAINT "inbound_receipt_lines_plan_item_id_inbound_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."inbound_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_receipts" ADD CONSTRAINT "inbound_receipts_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_receipt_id_inbound_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inbound_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_line_id_inbound_receipt_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."inbound_receipt_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_plan_item_id_inbound_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."inbound_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_work_logs" ADD CONSTRAINT "inbound_work_logs_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_columns" ADD CONSTRAINT "location_columns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_racks" ADD CONSTRAINT "location_racks_column_id_location_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."location_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_rack_id_location_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."location_racks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_job_id_movement_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."movement_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_job_lines" ADD CONSTRAINT "movement_job_lines_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_jobs" ADD CONSTRAINT "movement_jobs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_jobs" ADD CONSTRAINT "movement_jobs_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_job_id_movement_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."movement_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_line_id_movement_job_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."movement_job_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_work_logs" ADD CONSTRAINT "movement_work_logs_event_id_stock_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."stock_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batches" ADD CONSTRAINT "outbound_batches_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_items" ADD CONSTRAINT "outbound_task_items_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_items" ADD CONSTRAINT "outbound_task_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_lines" ADD CONSTRAINT "outbound_task_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_orders" ADD CONSTRAINT "outbound_task_orders_task_id_outbound_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."outbound_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_task_orders" ADD CONSTRAINT "outbound_task_orders_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_tasks" ADD CONSTRAINT "outbound_tasks_merge_group_id_merge_groups_id_fk" FOREIGN KEY ("merge_group_id") REFERENCES "public"."merge_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_matchings" ADD CONSTRAINT "product_matchings_sku_group_id_sku_groups_id_fk" FOREIGN KEY ("sku_group_id") REFERENCES "public"."sku_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mapping_items" ADD CONSTRAINT "product_sku_mapping_items_mapping_id_product_sku_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."product_sku_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mapping_items" ADD CONSTRAINT "product_sku_mapping_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mapping_snapshots" ADD CONSTRAINT "product_sku_mapping_snapshots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mapping_snapshots" ADD CONSTRAINT "product_sku_mapping_snapshots_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mapping_snapshots" ADD CONSTRAINT "product_sku_mapping_snapshots_mapping_id_product_sku_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."product_sku_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sku_mappings" ADD CONSTRAINT "product_sku_mappings_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_sku_links" ADD CONSTRAINT "product_variant_sku_links_product_matching_id_product_matchings_id_fk" FOREIGN KEY ("product_matching_id") REFERENCES "public"."product_matchings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_sku_links" ADD CONSTRAINT "product_variant_sku_links_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_cart" ADD CONSTRAINT "purchase_order_cart_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_cart" ADD CONSTRAINT "purchase_order_cart_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_destination_warehouse_id_warehouses_id_fk" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_matching_id_product_matchings_id_fk" FOREIGN KEY ("product_matching_id") REFERENCES "public"."product_matchings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_mapping_snapshot_id_product_sku_mapping_snapshots_id_fk" FOREIGN KEY ("mapping_snapshot_id") REFERENCES "public"."product_sku_mapping_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_fulfillment_order_id_fulfillment_orders_id_fk" FOREIGN KEY ("fulfillment_order_id") REFERENCES "public"."fulfillment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_barcodes" ADD CONSTRAINT "sku_barcodes_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_categories" ADD CONSTRAINT "sku_categories_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_categories" ADD CONSTRAINT "sku_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_images" ADD CONSTRAINT "sku_images_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_location_movements" ADD CONSTRAINT "sku_location_movements_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_location_movements" ADD CONSTRAINT "sku_location_movements_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_location_movements" ADD CONSTRAINT "sku_location_movements_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_managers" ADD CONSTRAINT "sku_managers_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_suppliers" ADD CONSTRAINT "sku_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_holder_id_holders_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."holders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_group_id_sku_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."sku_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_delivery_profile_id_delivery_profiles_id_fk" FOREIGN KEY ("delivery_profile_id") REFERENCES "public"."delivery_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_logistics_partner_id_suppliers_id_fk" FOREIGN KEY ("logistics_partner_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_primary_location_id_locations_id_fk" FOREIGN KEY ("primary_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_secondary_location_id_locations_id_fk" FOREIGN KEY ("secondary_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_journal_id_stock_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_to_warehouse_id_warehouses_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "stock_ledgers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_fulfillment_order_item_id_fulfillment_order_items_id_fk" FOREIGN KEY ("fulfillment_order_item_id") REFERENCES "public"."fulfillment_order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_adjustments" ADD CONSTRAINT "stocktaking_adjustments_session_id_stocktaking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stocktaking_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_adjustments" ADD CONSTRAINT "stocktaking_adjustments_line_id_stocktaking_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."stocktaking_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_adjustments" ADD CONSTRAINT "stocktaking_adjustments_stock_event_id_stock_events_id_fk" FOREIGN KEY ("stock_event_id") REFERENCES "public"."stock_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD CONSTRAINT "stocktaking_lines_session_id_stocktaking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stocktaking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD CONSTRAINT "stocktaking_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD CONSTRAINT "stocktaking_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stocktaking_sessions" ADD CONSTRAINT "stocktaking_sessions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_category_mappings" ADD CONSTRAINT "supplier_category_mappings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_category_mappings" ADD CONSTRAINT "supplier_category_mappings_category_id_supplier_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."supplier_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_warehouse_id_warehouses_id_fk" FOREIGN KEY ("default_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."role_scope_mapping" ADD CONSTRAINT "role_scope_mapping_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "auth"."scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_banner_groups_code" ON "banner_groups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_banner_groups_category" ON "banner_groups" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_banner_groups_active" ON "banner_groups" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_banner_groups_deleted_at" ON "banner_groups" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_banners_group_id" ON "banners" USING btree ("banner_group_id");--> statement-breakpoint
CREATE INDEX "idx_banners_active" ON "banners" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_banners_display_period" ON "banners" USING btree ("display_start_at","display_end_at");--> statement-breakpoint
CREATE INDEX "idx_banners_deleted_at" ON "banners" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_banners_group_sort" ON "banners" USING btree ("banner_group_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_category_tag_groups_category" ON "category_tag_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_category_tag_groups_group" ON "category_tag_groups" USING btree ("tag_group_id");--> statement-breakpoint
CREATE INDEX "idx_category_tag_groups_display_order" ON "category_tag_groups" USING btree ("category_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_channel_categories_order" ON "channel_categories" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "idx_channel_products_master" ON "channel_products" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_channel_products_channel" ON "channel_products" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_products_active" ON "channel_products" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_channel" ON "channel_products" USING btree ("master_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_variant_listing" ON "channel_variant_listings" USING btree ("sales_channel_id","channel_item_id");--> statement-breakpoint
CREATE INDEX "idx_channel_listings_variant" ON "channel_variant_listings" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_channel_listings_channel" ON "channel_variant_listings" USING btree ("sales_channel_id");--> statement-breakpoint
CREATE INDEX "idx_notices_category" ON "notices" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_notices_active" ON "notices" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_notices_pinned" ON "notices" USING btree ("is_pinned");--> statement-breakpoint
CREATE INDEX "idx_notices_display_period" ON "notices" USING btree ("display_start_at","display_end_at");--> statement-breakpoint
CREATE INDEX "idx_notices_deleted_at" ON "notices" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_notices_sort" ON "notices" USING btree ("is_pinned","sort_order","created_at");--> statement-breakpoint
CREATE INDEX "idx_approval_history_version" ON "product_approval_history" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_approval_history_status" ON "product_approval_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_approval_history_date" ON "product_approval_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_version" ON "product_audit_log" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "product_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_log_timestamp" ON "product_audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_audit_log_user" ON "product_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_categories_parent_id" ON "product_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_categories_level" ON "product_categories" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_categories_path" ON "product_categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "idx_categories_slug" ON "product_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_categories_active" ON "product_categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_categories_sort_order" ON "product_categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_product_images_version" ON "product_images" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_product_images_primary" ON "product_images" USING btree ("version_id","is_primary");--> statement-breakpoint
CREATE INDEX "idx_product_images_sort" ON "product_images" USING btree ("version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_product_primary_image" ON "product_images" USING btree ("version_id") WHERE "product_images"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "idx_master_categories_master_version" ON "product_master_categories" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_master_categories_category" ON "product_master_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_master_categories_primary" ON "product_master_categories" USING btree ("master_id","is_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_category_version" ON "product_master_categories" USING btree ("master_id","category_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_master_option_groups_master_version" ON "product_master_option_groups" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_option_group_version" ON "product_master_option_groups" USING btree ("master_id","option_group_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_master_pricing_rules_master_version" ON "product_master_pricing_rules" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_pricing_rule_version" ON "product_master_pricing_rules" USING btree ("master_id","pricing_rule_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_master_variants_master_version" ON "product_master_variants" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_variant_version" ON "product_master_variants" USING btree ("master_id","variant_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_versions_master_id" ON "product_master_versions" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_versions_status" ON "product_master_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_versions_master_version" ON "product_master_versions" USING btree ("master_id","version");--> statement-breakpoint
CREATE INDEX "idx_versions_name" ON "product_master_versions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_versions_brand" ON "product_master_versions" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_versions_created_at" ON "product_master_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_versions_product_type" ON "product_master_versions" USING btree ("product_type");--> statement-breakpoint
CREATE INDEX "idx_versions_product_code" ON "product_master_versions" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX "idx_versions_approval_status" ON "product_master_versions" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "idx_versions_deleted_at" ON "product_master_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_versions_supplier" ON "product_master_versions" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_versions_sales_dates" ON "product_master_versions" USING btree ("sales_start_date","sales_end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_active_version" ON "product_master_versions" USING btree ("master_id") WHERE "product_master_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "unique_master_version" ON "product_master_versions" USING btree ("master_id","version");--> statement-breakpoint
CREATE INDEX "idx_masters_created_at" ON "product_masters" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_masters_deleted_at" ON "product_masters" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_option_group_displays_lookup" ON "product_option_group_displays" USING btree ("option_group_id","master_id","version_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_option_group_display" ON "product_option_group_displays" USING btree ("option_group_id","master_id","version_id","locale");--> statement-breakpoint
CREATE INDEX "idx_option_value_displays_lookup" ON "product_option_value_displays" USING btree ("option_value_id","master_id","version_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_option_value_display" ON "product_option_value_displays" USING btree ("option_value_id","master_id","version_id","locale");--> statement-breakpoint
CREATE INDEX "idx_option_values_group" ON "product_option_values" USING btree ("option_group_id");--> statement-breakpoint
CREATE INDEX "idx_product_tag_values_master_version" ON "product_tag_values" USING btree ("master_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_product_tag_values_tag" ON "product_tag_values" USING btree ("tag_value_id");--> statement-breakpoint
CREATE INDEX "idx_variant_price_cache_version" ON "product_variant_price_cache" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_variant_price_cache_variant" ON "product_variant_price_cache" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_variant_price_cache_version_variant" ON "product_variant_price_cache" USING btree ("version_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_variants_status" ON "product_variants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_variants_is_default" ON "product_variants" USING btree ("is_default");--> statement-breakpoint
CREATE INDEX "idx_variants_created_at" ON "product_variants" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_variants_code" ON "product_variants" USING btree ("variant_code");--> statement-breakpoint
CREATE INDEX "idx_sales_channels_type" ON "sales_channels" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_sales_channels_site" ON "sales_channels" USING btree ("site");--> statement-breakpoint
CREATE INDEX "idx_sales_channels_category" ON "sales_channels" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_sales_channels_active" ON "sales_channels" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_tag_groups_active" ON "tag_groups" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_tag_groups_display_order" ON "tag_groups" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "idx_tag_values_group_id" ON "tag_values" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_tag_values_active" ON "tag_values" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_tag_values_display_order" ON "tag_values" USING btree ("group_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_tag_values_group_name" ON "tag_values" USING btree ("group_id","name");--> statement-breakpoint
CREATE INDEX "idx_variant_options_variant" ON "variant_option_values" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_variant_options_value" ON "variant_option_values" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_variant_option_values" ON "variant_option_values" USING btree ("variant_id","option_value_id");--> statement-breakpoint
CREATE INDEX "idx_audit_timestamp" ON "audit_logs" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_event_type" ON "audit_logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_audit_resource_type" ON "audit_logs" USING btree ("resource_type");--> statement-breakpoint
CREATE INDEX "idx_audit_resource_id" ON "audit_logs" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_module" ON "audit_logs" USING btree ("module");--> statement-breakpoint
CREATE INDEX "idx_audit_severity" ON "audit_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_audit_user_id" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_correlation_id" ON "audit_logs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_audit_resource_search" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_time_module" ON "audit_logs" USING btree ("timestamp" DESC NULLS LAST,"module");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_order_batches_batch" ON "fulfillment_order_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_order_items_fo" ON "fulfillment_order_items" USING btree ("fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_order_items_so" ON "fulfillment_order_items" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_order_items_sku" ON "fulfillment_order_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_order_items_variant" ON "fulfillment_order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plan_items_plan" ON "inbound_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plan_items_sku" ON "inbound_plan_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_wh_date" ON "inbound_plans" USING btree ("warehouse_id","expected_date");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_destination" ON "inbound_plans" USING btree ("destination_warehouse_id","expected_date");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_warehouse_type_status" ON "inbound_plans" USING btree ("warehouse_id","plan_type","status");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_parent" ON "inbound_plans" USING btree ("parent_plan_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_plans_purchase_order" ON "inbound_plans" USING btree ("linked_purchase_order_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_lines_receipt" ON "inbound_receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_lines_sku" ON "inbound_receipt_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_inbound_receipts_wh_time" ON "inbound_receipts" USING btree ("warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_inbound_work_time" ON "inbound_work_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_invoices_fo" ON "invoices" USING btree ("fulfillment_order_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_number" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_columns_warehouse_name" ON "location_columns" USING btree ("warehouse_id","column_name");--> statement-breakpoint
CREATE INDEX "idx_racks_column_number" ON "location_racks" USING btree ("column_id","rack_number");--> statement-breakpoint
CREATE INDEX "idx_locations_warehouse_type" ON "locations" USING btree ("warehouse_id","location_type");--> statement-breakpoint
CREATE INDEX "idx_locations_rack_bin" ON "locations" USING btree ("rack_id","bin_identifier");--> statement-breakpoint
CREATE INDEX "idx_movement_lines_job" ON "movement_job_lines" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_movement_lines_sku" ON "movement_job_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_movement_jobs_wh_time" ON "movement_jobs" USING btree ("warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_movement_work_time" ON "movement_work_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_outbound_batches_warehouse_status" ON "outbound_batches" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "idx_outbound_batches_number" ON "outbound_batches" USING btree ("batch_number");--> statement-breakpoint
CREATE INDEX "idx_outbox_status_next" ON "outbox_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_product_matchings_master_id" ON "product_matchings" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "idx_product_sku_mapping_items_mapping" ON "product_sku_mapping_items" USING btree ("mapping_id");--> statement-breakpoint
CREATE INDEX "uq_product_sku_mapping_items_mapping_variant" ON "product_sku_mapping_items" USING btree ("mapping_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_product_sku_mapping_snapshots_product" ON "product_sku_mapping_snapshots" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_product_sku_mappings_product_warehouse" ON "product_sku_mappings" USING btree ("product_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "idx_product_sku_mappings_active" ON "product_sku_mappings" USING btree ("product_id","warehouse_id","is_active");--> statement-breakpoint
CREATE INDEX "return_items_return_idx" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_items_sku_idx" ON "return_items" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "return_items_qc_status_idx" ON "return_items" USING btree ("qc_status");--> statement-breakpoint
CREATE INDEX "returns_warehouse_idx" ON "returns" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "returns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_snapshot" ON "sales_order_lines" USING btree ("mapping_snapshot_id");--> statement-breakpoint
CREATE INDEX "idx_sku_groups_code" ON "sku_groups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_sku_groups_name" ON "sku_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_sku_images_sku_id" ON "sku_images" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_sku_images_primary" ON "sku_images" USING btree ("sku_id","is_primary");--> statement-breakpoint
CREATE INDEX "idx_sku_images_sort" ON "sku_images" USING btree ("sku_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_movement_sku" ON "sku_location_movements" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_movement_barcode" ON "sku_location_movements" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "idx_movement_timestamp" ON "sku_location_movements" USING btree ("movement_timestamp");--> statement-breakpoint
CREATE INDEX "idx_skus_safety_stock" ON "skus" USING btree ("safety_stock");--> statement-breakpoint
CREATE INDEX "idx_skus_variant_group" ON "skus" USING btree ("variant_group_code");--> statement-breakpoint
CREATE INDEX "idx_skus_primary_location" ON "skus" USING btree ("primary_location_id");--> statement-breakpoint
CREATE INDEX "idx_skus_weight" ON "skus" USING btree ("product_weight");--> statement-breakpoint
CREATE INDEX "idx_skus_moq" ON "skus" USING btree ("moq");--> statement-breakpoint
CREATE INDEX "idx_skus_group_id" ON "skus" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "ix_stock_events_grain_time" ON "stock_events" USING btree ("sku_id","from_warehouse_id","to_warehouse_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_ledgers_lookup" ON "stock_ledgers" USING btree ("sku_id","warehouse_id","location_id","stock_state");--> statement-breakpoint
CREATE INDEX "stock_reservations_target_idx" ON "stock_reservations" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_sku_warehouse_idx" ON "stock_reservations" USING btree ("sku_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_status_idx" ON "stock_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_adjustment_session" ON "stocktaking_adjustments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_adjustment_line" ON "stocktaking_adjustments" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "idx_stocktaking_line_session" ON "stocktaking_lines" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_stocktaking_line_sku" ON "stocktaking_lines" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "idx_stocktaking_line_location" ON "stocktaking_lines" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");--> statement-breakpoint
CREATE VIEW "public"."stock_summary_view" AS (
    SELECT
        s.id as sku_id,
        w.id as warehouse_id,
        s.name as sku_name,
        w.name as warehouse_name,

        -- 물리적 재고
        COALESCE(on_hand.qty, 0) as on_hand_qty,
        COALESCE(defective.qty, 0) as defective_qty,
        COALESCE(in_transfer.qty, 0) as in_transfer_qty,

        -- 예약 상태
        COALESCE(reserved.qty, 0) as reserved_qty,
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) - COALESCE(transit_out.qty, 0) as available_qty,

        -- 예정 상태
        COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
        0 as on_order_qty,
        COALESCE(transit_out.qty, 0) as transfer_pending_qty,

        -- 계산된 전망
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) + COALESCE(inbound_pending.qty, 0) as projected_available_qty,

        NOW() as last_calculated_at

    FROM skus s
    CROSS JOIN warehouses w
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'ON_HAND'
        GROUP BY sku_id, warehouse_id
    ) on_hand ON s.id = on_hand.sku_id AND w.id = on_hand.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'DEFECTIVE'
        GROUP BY sku_id, warehouse_id
    ) defective ON s.id = defective.sku_id AND w.id = defective.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'IN_TRANSFER'
        GROUP BY sku_id, warehouse_id
    ) in_transfer ON s.id = in_transfer.sku_id AND w.id = in_transfer.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(quantity) as qty
        FROM stock_reservations
        WHERE status = 'confirmed'
        GROUP BY sku_id, warehouse_id
    ) reserved ON s.id = reserved.sku_id AND w.id = reserved.warehouse_id
    LEFT JOIN (
        SELECT ipi.sku_id, ip.destination_warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending'
        GROUP BY ipi.sku_id, ip.destination_warehouse_id
    ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.destination_warehouse_id
    LEFT JOIN (
        SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending' AND ip.requires_transfer = true AND ip.warehouse_id != ip.destination_warehouse_id
        GROUP BY ipi.sku_id, ip.warehouse_id
    ) transit_out ON s.id = transit_out.sku_id AND w.id = transit_out.warehouse_id
);