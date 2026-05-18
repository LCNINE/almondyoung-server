CREATE SCHEMA "event";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'SCHEDULED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('EMAIL', 'SMS', 'KAKAO', 'PUSH');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('ios', 'android', 'web');--> statement-breakpoint
CREATE TYPE "public"."kakao_template_status" AS ENUM('PENDING', 'REQUESTED', 'APPROVED', 'REJECTED', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('ko', 'en');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('INFORMATIONAL', 'MARKETING', 'TRANSACTIONAL', 'SYSTEM', 'ADMIN', 'OPERATIONAL', 'CUSTOMER_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('URGENT', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED', 'RETRYING');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('ACTIVE', 'INACTIVE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('all', 'filter', 'excel', 'search');--> statement-breakpoint
CREATE TABLE "alerts" (
	"alert_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"context" jsonb NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"recipient_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"channel" "channel" NOT NULL,
	"status" varchar(50) NOT NULL,
	"error_message" text,
	"attempted_at" timestamp NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "campaign_target_groups" (
	"group_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "target_type" NOT NULL,
	"criteria" jsonb,
	"user_list" jsonb,
	"user_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fcm_tokens" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"token" varchar(500) NOT NULL,
	"device_id" varchar(255),
	"platform" "device_platform" NOT NULL,
	"app_version" varchar(50),
	"os_version" varchar(50),
	"device_model" varchar(100),
	"device_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"topics" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fcm_topic_subscriptions" (
	"subscription_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"token_id" uuid,
	"topic" varchar(255) NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_campaigns" (
	"campaign_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" "notification_category" NOT NULL,
	"channels" jsonb NOT NULL,
	"template_id" uuid,
	"content" jsonb,
	"send_at" timestamp,
	"priority" "notification_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"stats" jsonb DEFAULT '{"sent":0,"delivered":0,"failed":0,"opened":0,"clicked":0}',
	"metadata" jsonb,
	"created_by" varchar(100) NOT NULL,
	"approved_by" varchar(100),
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"template_key" varchar(100) NOT NULL,
	"category" "notification_category" NOT NULL,
	"default_channels" jsonb NOT NULL,
	"priority" "notification_priority" DEFAULT 'NORMAL' NOT NULL,
	"conditions" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"name" varchar(255) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"campaign_id" uuid,
	"user_id" varchar(100),
	"event_key" varchar(100),
	"channel" "channel" NOT NULL,
	"provider" varchar(50) NOT NULL,
	"status" "notification_status" NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"latency_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_providers" (
	"provider_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "channel" NOT NULL,
	"provider_name" varchar(50) NOT NULL,
	"config" jsonb NOT NULL,
	"status" "provider_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"capabilities" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"notification_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" varchar(100),
	"user_id" varchar(100) NOT NULL,
	"event_key" varchar(100),
	"template_key" varchar(100),
	"template_id" uuid,
	"campaign_id" uuid,
	"category" "notification_category" NOT NULL,
	"priority" "notification_priority" DEFAULT 'NORMAL' NOT NULL,
	"channel" "channel" NOT NULL,
	"provider_id" uuid,
	"language" "language" NOT NULL,
	"payload" jsonb,
	"rendered_content" jsonb,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"send_at" timestamp,
	"sent_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"error_details" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"receipt_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid,
	"campaign_id" uuid,
	"provider" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"provider_response" jsonb,
	"latency_ms" integer,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"template_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" "notification_category" NOT NULL,
	"contents" jsonb NOT NULL,
	"variables_schema" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"kakao_template_code" varchar(100),
	"kakao_template_status" "kakao_template_status",
	"provider_template_id" varchar(255),
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE INDEX "idx_alert_unresolved" ON "alerts" USING btree ("is_resolved","created_at");--> statement-breakpoint
CREATE INDEX "idx_campaign_user" ON "campaign_recipients" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_target" ON "campaign_target_groups" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_fcm_user_id" ON "fcm_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fcm_token" ON "fcm_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_device" ON "fcm_tokens" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "idx_active_tokens" ON "fcm_tokens" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_fcm_platform" ON "fcm_tokens" USING btree ("platform");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_topic" ON "fcm_topic_subscriptions" USING btree ("user_id","topic");--> statement-breakpoint
CREATE INDEX "idx_token_topic" ON "fcm_topic_subscriptions" USING btree ("token_id","topic");--> statement-breakpoint
CREATE INDEX "idx_topic" ON "fcm_topic_subscriptions" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "idx_campaign_status" ON "notification_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaign_send_at" ON "notification_campaigns" USING btree ("send_at");--> statement-breakpoint
CREATE INDEX "idx_campaign_category" ON "notification_campaigns" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_event_key_active" ON "notification_events" USING btree ("event_key","is_active");--> statement-breakpoint
CREATE INDEX "idx_log_user_created" ON "notification_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_log_event_created" ON "notification_logs" USING btree ("event_key","created_at");--> statement-breakpoint
CREATE INDEX "idx_log_campaign" ON "notification_logs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_log_created" ON "notification_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_channel_active_priority" ON "notification_providers" USING btree ("channel","is_active","priority");--> statement-breakpoint
CREATE INDEX "idx_user_status_created" ON "notifications" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_status_send_at" ON "notifications" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "idx_status_retry" ON "notifications" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "idx_campaign" ON "notifications" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_category_priority" ON "notifications" USING btree ("category","priority");--> statement-breakpoint
CREATE INDEX "idx_receipt_notification" ON "receipts" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_campaign" ON "receipts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_receipt_timestamp" ON "receipts" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_template_key_active" ON "templates" USING btree ("template_key","is_active");--> statement-breakpoint
CREATE INDEX "idx_template_category" ON "templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_kakao_template_code" ON "templates" USING btree ("kakao_template_code");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "event"."outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "event"."outbox_events" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "erl_chain_idx" ON "event"."event_resource_links" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "erl_resource_idx" ON "event"."event_resource_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "erl_event_idx" ON "event"."event_resource_links" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_unique_idx" ON "auth"."role_scope_mapping" USING btree ("role_name","scope_id");