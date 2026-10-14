ALTER TABLE "charges" ALTER COLUMN "provider_transaction_id" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "provider_refund_id" SET DATA TYPE varchar(200);