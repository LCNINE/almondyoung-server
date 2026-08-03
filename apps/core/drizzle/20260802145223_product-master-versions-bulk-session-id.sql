ALTER TABLE "product_master_versions" ADD COLUMN "bulk_session_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_versions_bulk_session" ON "product_master_versions" USING btree ("bulk_session_id");