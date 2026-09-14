ALTER TABLE "stocktaking_lines" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD COLUMN "count_baseline_version" integer;--> statement-breakpoint
ALTER TABLE "stocktaking_sessions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;