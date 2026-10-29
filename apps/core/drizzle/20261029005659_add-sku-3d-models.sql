CREATE TABLE "sku_3d_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"glb_file_id" uuid,
	"status" varchar(32) NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_sku_3d_models_version" CHECK ("sku_3d_models"."version" > 0),
	CONSTRAINT "ck_sku_3d_models_status" CHECK ("sku_3d_models"."status" IN ('approved', 'needs_revision', 'needs_more_photos', 'failed')),
	CONSTRAINT "ck_sku_3d_models_approved_file" CHECK ("sku_3d_models"."status" <> 'approved' OR "sku_3d_models"."glb_file_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "sku_3d_models" ADD CONSTRAINT "sku_3d_models_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_3d_models_sku_version" ON "sku_3d_models" USING btree ("sku_id","version");