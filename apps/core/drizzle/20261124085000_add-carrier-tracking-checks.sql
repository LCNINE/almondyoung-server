CREATE TABLE "carrier_tracking_checks" (
	"dispatch_attempt_id" uuid PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"error_code" varchar(64),
	"answered_at" timestamp with time zone,
	"scan_code" varchar(16),
	"scan_status" varchar(16),
	"scan_at" timestamp with time zone,
	"scan_location" varchar(255),
	"scan_reason" varchar(255),
	"accepted_scan_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "carrier_tracking_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispatch_attempt_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"scan_key" varchar(64) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"resume_at" timestamp with time zone,
	"note" varchar(500) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_carrier_tracking_confirmations_resume" CHECK (("carrier_tracking_confirmations"."outcome" = 'wait' AND "carrier_tracking_confirmations"."resume_at" IS NOT NULL) OR ("carrier_tracking_confirmations"."outcome" = 'closed' AND "carrier_tracking_confirmations"."resume_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "carrier_tracking_checks" ADD CONSTRAINT "carrier_tracking_checks_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_tracking_confirmations" ADD CONSTRAINT "carrier_tracking_confirmations_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_carrier_tracking_checks_accepted" ON "carrier_tracking_checks" USING btree ("accepted_scan_at") WHERE "carrier_tracking_checks"."accepted_scan_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_carrier_tracking_confirmations_attempt" ON "carrier_tracking_confirmations" USING btree ("dispatch_attempt_id","created_at");