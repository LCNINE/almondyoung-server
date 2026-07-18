ALTER TABLE "dispatch_attempts" DROP CONSTRAINT "dispatch_attempts_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "dispatch_attempts" DROP COLUMN "invoice_id";