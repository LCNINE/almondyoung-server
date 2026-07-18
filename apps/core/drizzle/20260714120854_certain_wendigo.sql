CREATE TYPE "public"."batch_inventory_custody_type" AS ENUM('AT_SOURCE', 'WORKER', 'BULK_CART', 'TOTE', 'SORTING', 'PACKING', 'PACKED', 'RETURN_PENDING', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."batch_inventory_session_status" AS ENUM('active', 'settled', 'recovery_required', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."dispatch_attempt_status" AS ENUM('pending', 'dispatched', 'recalled', 'recovery_required');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_command_request_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."invoice_operation_status" AS ENUM('pending', 'in_progress', 'succeeded', 'failed', 'recovery_required');--> statement-breakpoint
CREATE TYPE "public"."invoice_operation_type" AS ENUM('issue', 'void');--> statement-breakpoint
CREATE TYPE "public"."outbound_batch_work_item_status" AS ENUM('queued', 'picking', 'ready_to_pack', 'packing', 'completed', 'short_pick_recovery', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."picking_plan_status" AS ENUM('draft', 'active', 'invalidated', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."picking_strategy" AS ENUM('discrete', 'aggregate_then_sort', 'pick_to_tote');--> statement-breakpoint
CREATE TYPE "public"."shipment_operation_member_role" AS ENUM('source', 'target');--> statement-breakpoint
CREATE TYPE "public"."shipment_operation_status" AS ENUM('pending', 'completed', 'failed', 'recovery_required');--> statement-breakpoint
CREATE TYPE "public"."shipment_operation_type" AS ENUM('split', 'consolidate', 'recipient_revision', 'cancel', 'reopen', 'plan', 'replan', 'short_pick', 'recall');--> statement-breakpoint
CREATE TYPE "public"."tote_status" AS ENUM('available', 'in_use', 'damaged', 'retired');--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'partially_reserved' BEFORE 'reserving';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'processing' BEFORE 'unfulfillable';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'partially_shipped' BEFORE 'canceled';--> statement-breakpoint
ALTER TYPE "public"."fulfillment_status" ADD VALUE 'recovery_required' BEFORE 'pending';--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'issuing';--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'voiding';--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'recovery_required';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'draft';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'planned';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'recovery_required';--> statement-breakpoint
ALTER TYPE "public"."system_location_role" ADD VALUE 'outbound_rework';--> statement-breakpoint
CREATE TABLE "batch_inventory_session_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"source_location_id" uuid,
	"custody_type" "batch_inventory_custody_type" NOT NULL,
	"custody_ref" varchar(255),
	"shipment_line_id" uuid,
	"qty" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_batch_inventory_session_balance_grain" UNIQUE NULLS NOT DISTINCT("session_id","sku_id","source_location_id","custody_type","custody_ref","shipment_line_id"),
	CONSTRAINT "ck_batch_inventory_session_balances_qty" CHECK ("batch_inventory_session_balances"."qty" >= 0),
	CONSTRAINT "ck_batch_inventory_session_balances_version" CHECK ("batch_inventory_session_balances"."version" > 0),
	CONSTRAINT "ck_batch_inventory_session_balances_custody" CHECK ((
        ("batch_inventory_session_balances"."custody_type" = 'AT_SOURCE' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NULL)
        OR ("batch_inventory_session_balances"."custody_type" = 'BULK_CART' AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NOT NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NULL)
        OR ("batch_inventory_session_balances"."custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NOT NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NOT NULL)
        OR ("batch_inventory_session_balances"."custody_type" IN ('RETURN_PENDING', 'SETTLED') AND "batch_inventory_session_balances"."source_location_id" IS NOT NULL AND "batch_inventory_session_balances"."custody_ref" IS NULL AND "batch_inventory_session_balances"."shipment_line_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "batch_inventory_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"sku_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"from_custody_type" "batch_inventory_custody_type",
	"from_custody_ref" varchar(255),
	"from_source_location_id" uuid,
	"from_shipment_line_id" uuid,
	"to_custody_type" "batch_inventory_custody_type",
	"to_custody_ref" varchar(255),
	"to_source_location_id" uuid,
	"to_shipment_line_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_batch_inventory_session_event_idempotency" UNIQUE("session_id","idempotency_key"),
	CONSTRAINT "ck_batch_inventory_session_events_qty_positive" CHECK ("batch_inventory_session_events"."quantity" > 0),
	CONSTRAINT "ck_batch_inventory_session_events_sides" CHECK ("batch_inventory_session_events"."from_custody_type" IS NOT NULL OR "batch_inventory_session_events"."to_custody_type" IS NOT NULL),
	CONSTRAINT "ck_batch_inventory_session_events_from_grain" CHECK ((
        ("batch_inventory_session_events"."from_custody_type" IS NULL AND "batch_inventory_session_events"."from_source_location_id" IS NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
        OR ("batch_inventory_session_events"."from_custody_type" IS NOT NULL AND (
          ("batch_inventory_session_events"."from_custody_type" = 'AT_SOURCE' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."from_custody_type" = 'BULK_CART' AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."from_custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NOT NULL)
          OR ("batch_inventory_session_events"."from_custody_type" IN ('RETURN_PENDING', 'SETTLED') AND "batch_inventory_session_events"."from_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."from_custody_ref" IS NULL AND "batch_inventory_session_events"."from_shipment_line_id" IS NOT NULL)
        ))
      )),
	CONSTRAINT "ck_batch_inventory_session_events_to_grain" CHECK ((
        ("batch_inventory_session_events"."to_custody_type" IS NULL AND "batch_inventory_session_events"."to_source_location_id" IS NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
        OR ("batch_inventory_session_events"."to_custody_type" IS NOT NULL AND (
          ("batch_inventory_session_events"."to_custody_type" = 'AT_SOURCE' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."to_custody_type" = 'BULK_CART' AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NULL)
          OR ("batch_inventory_session_events"."to_custody_type" IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NOT NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NOT NULL)
          OR ("batch_inventory_session_events"."to_custody_type" IN ('RETURN_PENDING', 'SETTLED') AND "batch_inventory_session_events"."to_source_location_id" IS NOT NULL AND "batch_inventory_session_events"."to_custody_ref" IS NULL AND "batch_inventory_session_events"."to_shipment_line_id" IS NOT NULL)
        ))
      ))
);
--> statement-breakpoint
CREATE TABLE "batch_inventory_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "batch_inventory_session_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"handed_in_qty" integer DEFAULT 0 NOT NULL,
	"settled_qty" integer DEFAULT 0 NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"shortage_qty" integer DEFAULT 0 NOT NULL,
	"recovery_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_batch_inventory_sessions_version_positive" CHECK ("batch_inventory_sessions"."version" > 0),
	CONSTRAINT "ck_batch_inventory_sessions_quantities" CHECK ("batch_inventory_sessions"."handed_in_qty" >= 0 AND "batch_inventory_sessions"."settled_qty" >= 0 AND "batch_inventory_sessions"."returned_qty" >= 0 AND "batch_inventory_sessions"."shortage_qty" >= 0),
	CONSTRAINT "ck_batch_inventory_sessions_settlement" CHECK ("batch_inventory_sessions"."settled_qty" + "batch_inventory_sessions"."returned_qty" + "batch_inventory_sessions"."shortage_qty" <= "batch_inventory_sessions"."handed_in_qty"),
	CONSTRAINT "ck_batch_inventory_sessions_recovery" CHECK ("batch_inventory_sessions"."status" <> 'recovery_required' OR "batch_inventory_sessions"."recovery_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "dispatch_attempt_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_attempt_id" uuid NOT NULL,
	"shipment_line_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"stock_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dispatch_attempt_sources_grain" UNIQUE("dispatch_attempt_id","shipment_line_id","source_location_id"),
	CONSTRAINT "ck_dispatch_attempt_sources_qty_positive" CHECK ("dispatch_attempt_sources"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" "dispatch_attempt_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"invoice_id" uuid,
	"stock_journal_id" uuid,
	"reversal_journal_id" uuid,
	"dispatched_at" timestamp with time zone,
	"carrier_accepted_at" timestamp with time zone,
	"recalled_at" timestamp with time zone,
	"recovery_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dispatch_attempts_shipment_attempt" UNIQUE("shipment_id","attempt_no"),
	CONSTRAINT "uq_dispatch_attempts_idempotency" UNIQUE("idempotency_key"),
	CONSTRAINT "ck_dispatch_attempts_attempt_no_positive" CHECK ("dispatch_attempts"."attempt_no" > 0),
	CONSTRAINT "ck_dispatch_attempts_dispatched_at" CHECK ("dispatch_attempts"."status" NOT IN ('dispatched', 'recalled') OR ("dispatch_attempts"."dispatched_at" IS NOT NULL AND "dispatch_attempts"."stock_journal_id" IS NOT NULL)),
	CONSTRAINT "ck_dispatch_attempts_recalled_at" CHECK ("dispatch_attempts"."status" <> 'recalled' OR ("dispatch_attempts"."recalled_at" IS NOT NULL AND "dispatch_attempts"."reversal_journal_id" IS NOT NULL)),
	CONSTRAINT "ck_dispatch_attempts_distinct_journals" CHECK ("dispatch_attempts"."stock_journal_id" IS NULL OR "dispatch_attempts"."reversal_journal_id" IS NULL OR "dispatch_attempts"."stock_journal_id" <> "dispatch_attempts"."reversal_journal_id"),
	CONSTRAINT "ck_dispatch_attempts_recall_chronology" CHECK ("dispatch_attempts"."status" <> 'recalled' OR "dispatch_attempts"."recalled_at" >= "dispatch_attempts"."dispatched_at"),
	CONSTRAINT "ck_dispatch_attempts_recall_carrier" CHECK ("dispatch_attempts"."status" <> 'recalled' OR "dispatch_attempts"."carrier_accepted_at" IS NULL),
	CONSTRAINT "ck_dispatch_attempts_carrier_acceptance" CHECK ("dispatch_attempts"."carrier_accepted_at" IS NULL OR ("dispatch_attempts"."dispatched_at" IS NOT NULL AND "dispatch_attempts"."carrier_accepted_at" >= "dispatch_attempts"."dispatched_at")),
	CONSTRAINT "ck_dispatch_attempts_recovery_code" CHECK ("dispatch_attempts"."status" <> 'recovery_required' OR "dispatch_attempts"."recovery_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "fulfillment_command_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_type" varchar(128) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" "fulfillment_command_request_status" DEFAULT 'pending' NOT NULL,
	"resource_type" varchar(64),
	"resource_id" uuid,
	"operation_id" uuid,
	"attempt_id" uuid,
	"response_snapshot" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_fulfillment_command_idempotency" UNIQUE("command_type","idempotency_key"),
	CONSTRAINT "ck_fulfillment_command_request_hash" CHECK (length("fulfillment_command_requests"."request_hash") = 64),
	CONSTRAINT "ck_fulfillment_command_completion" CHECK ("fulfillment_command_requests"."status" <> 'completed' OR ("fulfillment_command_requests"."completed_at" IS NOT NULL AND "fulfillment_command_requests"."response_snapshot" IS NOT NULL)),
	CONSTRAINT "ck_fulfillment_command_failure" CHECK ("fulfillment_command_requests"."status" <> 'failed' OR "fulfillment_command_requests"."last_error" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "invoice_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"invoice_id" uuid,
	"resume_operation_id" uuid,
	"operation" "invoice_operation_type" NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"manifest_version" integer NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"status" "invoice_operation_status" DEFAULT 'pending' NOT NULL,
	"provider_request" jsonb NOT NULL,
	"provider_response" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_invoice_operation_idempotency" UNIQUE("operation","idempotency_key"),
	CONSTRAINT "ck_invoice_operations_attempts" CHECK ("invoice_operations"."attempts" >= 0),
	CONSTRAINT "ck_invoice_operation_request_hash" CHECK (length("invoice_operations"."request_hash") = 64),
	CONSTRAINT "ck_invoice_operation_manifest_version" CHECK ("invoice_operations"."manifest_version" > 0),
	CONSTRAINT "ck_invoice_operation_recipient_hash" CHECK (length("invoice_operations"."recipient_hash") = 64),
	CONSTRAINT "ck_invoice_operation_completion" CHECK ("invoice_operations"."status" <> 'succeeded' OR ("invoice_operations"."invoice_id" IS NOT NULL AND "invoice_operations"."completed_at" IS NOT NULL)),
	CONSTRAINT "ck_invoice_operation_error_context" CHECK ("invoice_operations"."status" NOT IN ('failed', 'recovery_required') OR "invoice_operations"."last_error" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "outbound_batch_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "outbound_batch_work_item_status" DEFAULT 'queued' NOT NULL,
	"picker_id" uuid,
	"picker_claimed_at" timestamp with time zone,
	"picker_released_at" timestamp with time zone,
	"packer_id" uuid,
	"packer_claimed_at" timestamp with time zone,
	"packer_released_at" timestamp with time zone,
	"handed_off_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"exclusion_reason" text,
	"recovery_reason" text,
	"waiting_operation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_outbound_work_items_lease_version" CHECK ("outbound_batch_work_items"."lease_version" >= 0),
	CONSTRAINT "ck_outbound_work_items_exclusion" CHECK ("outbound_batch_work_items"."status" <> 'excluded' OR "outbound_batch_work_items"."exclusion_reason" IS NOT NULL),
	CONSTRAINT "ck_outbound_work_items_recovery" CHECK ("outbound_batch_work_items"."status" <> 'short_pick_recovery' OR "outbound_batch_work_items"."recovery_reason" IS NOT NULL),
	CONSTRAINT "ck_outbound_work_items_completion" CHECK ("outbound_batch_work_items"."status" <> 'completed' OR "outbound_batch_work_items"."completed_at" IS NOT NULL),
	CONSTRAINT "ck_outbound_work_items_picker_release" CHECK ("outbound_batch_work_items"."picker_released_at" IS NULL OR ("outbound_batch_work_items"."picker_claimed_at" IS NOT NULL AND "outbound_batch_work_items"."picker_released_at" >= "outbound_batch_work_items"."picker_claimed_at")),
	CONSTRAINT "ck_outbound_work_items_packer_release" CHECK ("outbound_batch_work_items"."packer_released_at" IS NULL OR ("outbound_batch_work_items"."packer_claimed_at" IS NOT NULL AND "outbound_batch_work_items"."packer_released_at" >= "outbound_batch_work_items"."packer_claimed_at"))
);
--> statement-breakpoint
CREATE TABLE "picking_plan_members" (
	"plan_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"manifest_version" integer NOT NULL,
	"reservation_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "picking_plan_members_plan_id_shipment_id_pk" PRIMARY KEY("plan_id","shipment_id"),
	CONSTRAINT "ck_picking_plan_member_versions" CHECK ("picking_plan_members"."manifest_version" > 0 AND "picking_plan_members"."reservation_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "picking_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"strategy" "picking_strategy" NOT NULL,
	"status" "picking_plan_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_picking_plans_batch_version" UNIQUE("batch_id","version"),
	CONSTRAINT "ck_picking_plans_version_positive" CHECK ("picking_plans"."version" > 0),
	CONSTRAINT "ck_picking_plans_invalidation" CHECK ("picking_plans"."status" <> 'invalidated' OR ("picking_plans"."invalidated_at" IS NOT NULL AND "picking_plans"."invalidation_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "picking_source_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"shipment_line_id" uuid NOT NULL,
	"source_location_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"source_stock_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_picking_source_allocations_grain" UNIQUE("plan_id","shipment_line_id","source_location_id"),
	CONSTRAINT "ck_picking_source_allocations_qty_positive" CHECK ("picking_source_allocations"."qty" > 0),
	CONSTRAINT "ck_picking_source_allocations_stock_version" CHECK ("picking_source_allocations"."source_stock_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_operation_members" (
	"operation_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"role" "shipment_operation_member_role" NOT NULL,
	"before_manifest_version" integer,
	"after_manifest_version" integer,
	"before_manifest_snapshot" jsonb,
	"after_manifest_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_operation_members_operation_id_shipment_id_role_pk" PRIMARY KEY("operation_id","shipment_id","role"),
	CONSTRAINT "ck_shipment_operation_member_versions" CHECK (("shipment_operation_members"."before_manifest_version" IS NULL OR "shipment_operation_members"."before_manifest_version" > 0)
        AND ("shipment_operation_members"."after_manifest_version" IS NULL OR "shipment_operation_members"."after_manifest_version" > 0))
);
--> statement-breakpoint
CREATE TABLE "shipment_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "shipment_operation_type" NOT NULL,
	"status" "shipment_operation_status" DEFAULT 'pending' NOT NULL,
	"operator_id" uuid NOT NULL,
	"reason" varchar(255) NOT NULL,
	"cs_case_id" uuid,
	"note" text,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"before_manifest_snapshot" jsonb,
	"after_manifest_snapshot" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_shipment_operation_idempotency" UNIQUE("type","idempotency_key"),
	CONSTRAINT "ck_shipment_operation_request_hash" CHECK (length("shipment_operations"."request_hash") = 64),
	CONSTRAINT "ck_shipment_operation_completion" CHECK ("shipment_operations"."status" <> 'completed' OR "shipment_operations"."completed_at" IS NOT NULL),
	CONSTRAINT "ck_shipment_operation_error_context" CHECK ("shipment_operations"."status" NOT IN ('failed', 'recovery_required') OR "shipment_operations"."last_error" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "shipment_tote_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"tote_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "ck_shipment_tote_assignments_release" CHECK ("shipment_tote_assignments"."released_at" IS NULL OR "shipment_tote_assignments"."released_at" >= "shipment_tote_assignments"."assigned_at")
);
--> statement-breakpoint
CREATE TABLE "totes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"barcode" varchar(128) NOT NULL,
	"status" "tote_status" DEFAULT 'available' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_totes_barcode" UNIQUE("barcode"),
	CONSTRAINT "ck_totes_version_positive" CHECK ("totes"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "sender_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "origin_address_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "return_address_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "carrier_account_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "supported_fulfillment_modes" "fulfillment_mode"[];--> statement-breakpoint
ALTER TABLE "delivery_profiles" ADD COLUMN "handling_flags" jsonb;--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD COLUMN "canceled_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "topic" varchar(255);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "return_request_items" ADD COLUMN "shipment_line_id" uuid;--> statement-breakpoint
ALTER TABLE "return_request_items" ADD COLUMN "dispatch_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "channel_order_item_id" varchar(255);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "channel_product_id" varchar(255);--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "reserved_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "line_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD COLUMN "created_from_line_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD COLUMN "dispatch_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD COLUMN "provider_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "shipping_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "recipient_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "manifest_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "reservation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "recovery_code" varchar(128);--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "shipment_line_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "state_reason" varchar(128);--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN "supported_picking_strategies" "picking_strategy"[];--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" ADD CONSTRAINT "batch_inventory_session_balances_session_id_batch_inventory_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."batch_inventory_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" ADD CONSTRAINT "batch_inventory_session_balances_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" ADD CONSTRAINT "batch_inventory_session_balances_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_balances" ADD CONSTRAINT "batch_inventory_session_balances_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_session_id_batch_inventory_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."batch_inventory_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_from_source_location_id_locations_id_fk" FOREIGN KEY ("from_source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_from_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("from_shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_to_source_location_id_locations_id_fk" FOREIGN KEY ("to_source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_session_events" ADD CONSTRAINT "batch_inventory_session_events_to_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("to_shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_inventory_sessions" ADD CONSTRAINT "batch_inventory_sessions_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempt_sources" ADD CONSTRAINT "dispatch_attempt_sources_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempt_sources" ADD CONSTRAINT "dispatch_attempt_sources_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempt_sources" ADD CONSTRAINT "dispatch_attempt_sources_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempt_sources" ADD CONSTRAINT "dispatch_attempt_sources_stock_event_id_stock_events_id_fk" FOREIGN KEY ("stock_event_id") REFERENCES "public"."stock_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "dispatch_attempts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "dispatch_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "dispatch_attempts_stock_journal_id_stock_journals_id_fk" FOREIGN KEY ("stock_journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_attempts" ADD CONSTRAINT "dispatch_attempts_reversal_journal_id_stock_journals_id_fk" FOREIGN KEY ("reversal_journal_id") REFERENCES "public"."stock_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_command_requests" ADD CONSTRAINT "fulfillment_command_requests_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_operations" ADD CONSTRAINT "invoice_operations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_operations" ADD CONSTRAINT "invoice_operations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_operations" ADD CONSTRAINT "invoice_operations_resume_operation_id_shipment_operations_id_fk" FOREIGN KEY ("resume_operation_id") REFERENCES "public"."shipment_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_work_items" ADD CONSTRAINT "outbound_batch_work_items_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_work_items" ADD CONSTRAINT "outbound_batch_work_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_batch_work_items" ADD CONSTRAINT "outbound_batch_work_items_waiting_operation_id_shipment_operations_id_fk" FOREIGN KEY ("waiting_operation_id") REFERENCES "public"."shipment_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD CONSTRAINT "picking_plan_members_plan_id_picking_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."picking_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_plan_members" ADD CONSTRAINT "picking_plan_members_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_plans" ADD CONSTRAINT "picking_plans_batch_id_outbound_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."outbound_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "picking_source_allocations_plan_id_picking_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."picking_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "picking_source_allocations_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picking_source_allocations" ADD CONSTRAINT "picking_source_allocations_source_location_id_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_operation_members" ADD CONSTRAINT "shipment_operation_members_operation_id_shipment_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."shipment_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_operation_members" ADD CONSTRAINT "shipment_operation_members_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tote_assignments" ADD CONSTRAINT "shipment_tote_assignments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tote_assignments" ADD CONSTRAINT "shipment_tote_assignments_tote_id_totes_id_fk" FOREIGN KEY ("tote_id") REFERENCES "public"."totes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totes" ADD CONSTRAINT "totes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_balances_session" ON "batch_inventory_session_balances" USING btree ("session_id","custody_type");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_balances_line" ON "batch_inventory_session_balances" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_events_from_location" ON "batch_inventory_session_events" USING btree ("from_source_location_id");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_events_to_location" ON "batch_inventory_session_events" USING btree ("to_source_location_id");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_events_from_line" ON "batch_inventory_session_events" USING btree ("from_shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_session_events_to_line" ON "batch_inventory_session_events" USING btree ("to_shipment_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_batch_inventory_sessions_active_batch" ON "batch_inventory_sessions" USING btree ("batch_id") WHERE "batch_inventory_sessions"."status" IN ('active', 'recovery_required');--> statement-breakpoint
CREATE INDEX "idx_batch_inventory_sessions_status" ON "batch_inventory_sessions" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dispatch_attempt_sources_stock_event" ON "dispatch_attempt_sources" USING btree ("stock_event_id") WHERE "dispatch_attempt_sources"."stock_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_dispatch_attempt_sources_line" ON "dispatch_attempt_sources" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dispatch_attempts_stock_journal" ON "dispatch_attempts" USING btree ("stock_journal_id") WHERE "dispatch_attempts"."stock_journal_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dispatch_attempts_reversal_journal" ON "dispatch_attempts" USING btree ("reversal_journal_id") WHERE "dispatch_attempts"."reversal_journal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_dispatch_attempts_shipment_status" ON "dispatch_attempts" USING btree ("shipment_id","status");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_command_status" ON "fulfillment_command_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_command_operation" ON "fulfillment_command_requests" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "idx_fulfillment_command_attempt" ON "fulfillment_command_requests" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_operations_shipment" ON "invoice_operations" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_operations_resume_operation" ON "invoice_operations" USING btree ("resume_operation_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_operations_retry" ON "invoice_operations" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbound_work_item_active_shipment" ON "outbound_batch_work_items" USING btree ("shipment_id") WHERE "outbound_batch_work_items"."status" NOT IN ('completed', 'excluded');--> statement-breakpoint
CREATE INDEX "idx_outbound_work_items_batch_status" ON "outbound_batch_work_items" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "idx_outbound_work_items_waiting_operation" ON "outbound_batch_work_items" USING btree ("waiting_operation_id");--> statement-breakpoint
CREATE INDEX "idx_picking_plan_members_shipment" ON "picking_plan_members" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_picking_plans_batch_status" ON "picking_plans" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "idx_picking_source_allocations_line" ON "picking_source_allocations" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_shipment_operation_members_shipment" ON "shipment_operation_members" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_shipment_operation_status" ON "shipment_operations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shipment_tote_assignments_active_tote" ON "shipment_tote_assignments" USING btree ("tote_id") WHERE "shipment_tote_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shipment_tote_assignments_active_pair" ON "shipment_tote_assignments" USING btree ("shipment_id","tote_id") WHERE "shipment_tote_assignments"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_shipment_tote_assignments_shipment" ON "shipment_tote_assignments" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "idx_totes_warehouse_status" ON "totes" USING btree ("warehouse_id","status");--> statement-breakpoint
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_created_from_line_id_shipment_lines_id_fk" FOREIGN KEY ("created_from_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_shipping_profile_id_delivery_profiles_id_fk" FOREIGN KEY ("shipping_profile_id") REFERENCES "public"."delivery_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbox_topic_status_next" ON "outbox_events" USING btree ("topic","status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbox_topic_event_idempotency" ON "outbox_events" USING btree ("topic","event_type","idempotency_key") WHERE "outbox_events"."topic" IS NOT NULL AND "outbox_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_return_request_items_shipment_line" ON "return_request_items" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_return_request_items_dispatch_attempt" ON "return_request_items" USING btree ("dispatch_attempt_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_channel_order_item" ON "sales_order_lines" USING btree ("channel_order_item_id");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_channel_product" ON "sales_order_lines" USING btree ("channel_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_order_lines_order_channel_item" ON "sales_order_lines" USING btree ("sales_order_id","channel_order_item_id") WHERE "sales_order_lines"."channel_order_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_shipment_lines_created_from_line" ON "shipment_lines" USING btree ("created_from_line_id");--> statement-breakpoint
CREATE INDEX "idx_shipment_tracking_attempt" ON "shipment_tracking" USING btree ("dispatch_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shipment_tracking_provider_event" ON "shipment_tracking" USING btree ("provider_event_id") WHERE "shipment_tracking"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_shipments_shipping_profile" ON "shipments" USING btree ("shipping_profile_id");--> statement-breakpoint
CREATE INDEX "idx_shipments_warehouse_status" ON "shipments" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "idx_stock_reservations_shipment_line" ON "stock_reservations" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_stock_reservations_requested_at" ON "stock_reservations" USING btree ("requested_at");--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "ck_fulfillment_order_items_qty_positive" CHECK ("fulfillment_order_items"."qty" > 0);--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "ck_fulfillment_order_items_progress_nonnegative" CHECK ("fulfillment_order_items"."reserved_qty" >= 0 AND "fulfillment_order_items"."picked_qty" >= 0 AND "fulfillment_order_items"."shipped_qty" >= 0 AND "fulfillment_order_items"."canceled_qty" >= 0);--> statement-breakpoint
ALTER TABLE "fulfillment_order_items" ADD CONSTRAINT "ck_fulfillment_order_items_settled_within_qty" CHECK ("fulfillment_order_items"."shipped_qty" + "fulfillment_order_items"."canceled_qty" <= "fulfillment_order_items"."qty");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_manifest_version_positive" CHECK ("invoices"."manifest_version" IS NULL OR "invoices"."manifest_version" > 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_recipient_hash" CHECK ("invoices"."recipient_hash" IS NULL OR length("invoices"."recipient_hash") = 64);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "ck_invoices_recovery_state" CHECK ("invoices"."status"::text <> 'recovery_required' OR "invoices"."shipment_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "ck_outbox_routing_pair" CHECK (("outbox_events"."topic" IS NULL AND "outbox_events"."idempotency_key" IS NULL) OR ("outbox_events"."topic" IS NOT NULL AND "outbox_events"."idempotency_key" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "return_request_items" ADD CONSTRAINT "ck_return_request_items_quantity_positive" CHECK ("return_request_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "ck_shipment_lines_reserved_range" CHECK ("shipment_lines"."reserved_qty" >= 0 AND "shipment_lines"."reserved_qty" <= "shipment_lines"."qty");--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "ck_shipment_lines_line_version_positive" CHECK ("shipment_lines"."line_version" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_manifest_version_positive" CHECK ("shipments"."manifest_version" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_reservation_version_positive" CHECK ("shipments"."reservation_version" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_recovery_code" CHECK ("shipments"."status"::text <> 'recovery_required' OR "shipments"."recovery_code" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "ck_shipments_superseded_at" CHECK ("shipments"."status"::text <> 'superseded' OR "shipments"."superseded_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "stock_ledgers" ADD CONSTRAINT "ck_stock_ledgers_version_positive" CHECK ("stock_ledgers"."version" > 0);--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "ck_stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "ck_stock_reservations_invalidation" CHECK ("stock_reservations"."invalidated_at" IS NULL OR "stock_reservations"."state_reason" IS NOT NULL);
