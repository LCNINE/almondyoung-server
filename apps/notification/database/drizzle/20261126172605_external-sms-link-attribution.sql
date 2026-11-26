CREATE TABLE "external_sms_campaigns" (
	"campaign_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider" text NOT NULL,
	"created_by" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_sms_campaigns_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sms_link_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(16) NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_tracked_links" ALTER COLUMN "notification_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_tracked_links" ADD COLUMN "recipient_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "sms_tracked_links" ADD COLUMN "recipient_user_id" varchar(100);--> statement-breakpoint
ALTER TABLE "sms_link_attributions" ADD CONSTRAINT "sms_link_attributions_code_sms_tracked_links_code_fk" FOREIGN KEY ("code") REFERENCES "public"."sms_tracked_links"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_link_attribution" ON "sms_link_attributions" USING btree ("code","user_id","kind");