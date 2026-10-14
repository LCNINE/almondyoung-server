ALTER TABLE "print_orders" ADD COLUMN "cancel_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_orders" ADD COLUMN "cancel_resolved_by" uuid;