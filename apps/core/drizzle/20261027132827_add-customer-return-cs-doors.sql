ALTER TABLE "customer_return_lines" ADD COLUMN "missing_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "prepayment" jsonb;--> statement-breakpoint
ALTER TABLE "customer_returns" ADD COLUMN "cs_resolution" jsonb;--> statement-breakpoint
ALTER TABLE "customer_return_lines" ADD CONSTRAINT "ck_customer_return_lines_missing_qty_range" CHECK ("customer_return_lines"."missing_qty" >= 0 and "customer_return_lines"."missing_qty" <= "customer_return_lines"."quantity");