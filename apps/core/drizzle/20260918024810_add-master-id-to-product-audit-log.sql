ALTER TABLE "product_audit_log" ALTER COLUMN "version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD COLUMN IF NOT EXISTS "master_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_master" ON "product_audit_log" USING btree ("master_id");--> statement-breakpoint
UPDATE "product_audit_log" AS l SET "master_id" = v."master_id" FROM "product_master_versions" AS v WHERE l."version_id" = v."id" AND l."master_id" IS NULL;