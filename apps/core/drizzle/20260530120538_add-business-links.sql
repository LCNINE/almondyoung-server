CREATE TABLE "business_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" uuid,
	"source_external_ref" varchar(255),
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid,
	"target_external_ref" varchar(255),
	"relation_name" varchar(96) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_links_source_ref_required" CHECK ("business_links"."source_id" IS NOT NULL OR "business_links"."source_external_ref" IS NOT NULL),
	CONSTRAINT "business_links_target_ref_required" CHECK ("business_links"."target_id" IS NOT NULL OR "business_links"."target_external_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "idx_business_links_source_id" ON "business_links" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_business_links_source_external_ref" ON "business_links" USING btree ("source_type","source_external_ref");--> statement-breakpoint
CREATE INDEX "idx_business_links_target_id" ON "business_links" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_business_links_target_external_ref" ON "business_links" USING btree ("target_type","target_external_ref");--> statement-breakpoint
CREATE INDEX "idx_business_links_relation_name" ON "business_links" USING btree ("relation_name");--> statement-breakpoint
CREATE INDEX "idx_business_links_occurred_at" ON "business_links" USING btree ("occurred_at");