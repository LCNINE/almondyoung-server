ALTER TABLE "waybills" ADD COLUMN "transient_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waybills" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waybills" ADD CONSTRAINT "ck_waybills_transient_attempts" CHECK ("waybills"."transient_attempts" >= 0);