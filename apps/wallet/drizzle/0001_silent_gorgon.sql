ALTER TABLE "payment_institution" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "payment_institution" CASCADE;--> statement-breakpoint
ALTER TABLE "payment_method" RENAME COLUMN "institution_id" TO "institution_code";--> statement-breakpoint
ALTER TABLE "payment_method" DROP CONSTRAINT "payment_method_institution_id_payment_institution_id_fk";
