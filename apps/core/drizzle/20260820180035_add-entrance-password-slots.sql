ALTER TABLE "sales_orders" ADD COLUMN "entrance_password" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "entrance_password_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "entrance_password" text;