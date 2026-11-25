CREATE TABLE "sku_3d_workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_hash" char(64) NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_3d_workers_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "sku_3d_workshop_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"workshop_id" uuid NOT NULL,
	"job_id" uuid,
	"revision_id" uuid,
	"type" varchar(32) NOT NULL,
	"author_label" varchar(255),
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sku_3d_workshop_events_type" CHECK ("sku_3d_workshop_events"."type" IN ('user_message','assistant_message','progress','status'))
);
--> statement-breakpoint
CREATE TABLE "sku_3d_workshop_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"request" text DEFAULT '' NOT NULL,
	"base_revision_id" uuid,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"worker_id" uuid,
	"uploads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_snapshot" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_sku_3d_workshop_jobs_kind" CHECK ("sku_3d_workshop_jobs"."kind" IN ('create','revise')),
	CONSTRAINT "ck_sku_3d_workshop_jobs_status" CHECK ("sku_3d_workshop_jobs"."status" IN ('queued','running','succeeded','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "sku_3d_workshop_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"glb_file_id" uuid NOT NULL,
	"glb_sha256" char(64) NOT NULL,
	"glb_bytes" integer NOT NULL,
	"files" jsonb NOT NULL,
	"review" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"public_glb_file_id" uuid,
	"sku_3d_model_id" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sku_3d_workshops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"sku_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_label" varchar(255) NOT NULL,
	"codex_session_id" varchar(128),
	"dimension_basis" varchar(16) DEFAULT 'unknown' NOT NULL,
	"dimension_confirmed_at" timestamp with time zone,
	"dimension_confirmed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sku_3d_workshops_basis" CHECK ("sku_3d_workshops"."dimension_basis" IN ('body','package','unknown'))
);
--> statement-breakpoint
ALTER TABLE "sku_3d_workshop_events" ADD CONSTRAINT "sku_3d_workshop_events_workshop_id_sku_3d_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."sku_3d_workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_3d_workshop_jobs" ADD CONSTRAINT "sku_3d_workshop_jobs_workshop_id_sku_3d_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."sku_3d_workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_3d_workshop_revisions" ADD CONSTRAINT "sku_3d_workshop_revisions_workshop_id_sku_3d_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."sku_3d_workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_3d_workshop_revisions" ADD CONSTRAINT "sku_3d_workshop_revisions_job_id_sku_3d_workshop_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sku_3d_workshop_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_3d_workshop_revisions" ADD CONSTRAINT "sku_3d_workshop_revisions_sku_3d_model_id_sku_3d_models_id_fk" FOREIGN KEY ("sku_3d_model_id") REFERENCES "public"."sku_3d_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_3d_workshops" ADD CONSTRAINT "sku_3d_workshops_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sku_3d_workshop_events_workshop_seq" ON "sku_3d_workshop_events" USING btree ("workshop_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_3d_workshop_jobs_active" ON "sku_3d_workshop_jobs" USING btree ("workshop_id") WHERE "sku_3d_workshop_jobs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "idx_sku_3d_workshop_jobs_claim" ON "sku_3d_workshop_jobs" USING btree ("status","lease_until","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_3d_workshop_revisions_job" ON "sku_3d_workshop_revisions" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_3d_workshop_revisions_number" ON "sku_3d_workshop_revisions" USING btree ("workshop_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_3d_workshops_sku_owner" ON "sku_3d_workshops" USING btree ("sku_id","owner_id");--> statement-breakpoint
CREATE INDEX "idx_sku_3d_workshops_owner" ON "sku_3d_workshops" USING btree ("owner_id","updated_at");