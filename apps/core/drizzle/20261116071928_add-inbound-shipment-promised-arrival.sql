ALTER TABLE "inbound_shipments" ADD COLUMN "promised_arrival" date;
--> statement-breakpoint
UPDATE "inbound_shipments" SET "promised_arrival" = "expected_arrival" WHERE "confirmed_at" IS NOT NULL AND "promised_arrival" IS NULL;
