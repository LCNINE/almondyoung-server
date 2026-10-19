ALTER TABLE "attendance_leaves" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_leaves" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "attendance_leaves" ADD COLUMN "show_dday" boolean DEFAULT false NOT NULL;