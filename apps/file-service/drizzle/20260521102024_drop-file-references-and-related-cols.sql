ALTER TABLE "file_references" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "file_references" CASCADE;--> statement-breakpoint
DROP INDEX "idx_uploads_related";--> statement-breakpoint
ALTER TABLE "uploads" DROP COLUMN "related_type";--> statement-breakpoint
ALTER TABLE "uploads" DROP COLUMN "related_id";