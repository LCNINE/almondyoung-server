ALTER TABLE "print_orders" ALTER COLUMN "almond_design_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "print_file_id" uuid;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "print_file_id" uuid;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "file_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "file_rejected_jobstat" integer;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "file_resubmitted_at" timestamp with time zone;