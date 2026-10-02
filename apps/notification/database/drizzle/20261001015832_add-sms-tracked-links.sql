CREATE TABLE "sms_tracked_links" (
	"code" varchar(16) PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url" text NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"first_clicked_at" timestamp,
	"last_clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_tracked_links" ADD CONSTRAINT "sms_tracked_links_notification_id_notifications_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("notification_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sms_tracked_links_campaign" ON "sms_tracked_links" USING btree ("campaign_id");