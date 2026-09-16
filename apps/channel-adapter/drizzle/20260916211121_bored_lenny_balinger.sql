ALTER TABLE "demo_run_items" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "demo_runs" ADD COLUMN "request_input" jsonb;