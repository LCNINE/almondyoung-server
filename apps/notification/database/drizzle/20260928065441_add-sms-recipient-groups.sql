CREATE TABLE "sms_group_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone" varchar(20) PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_recipient_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_by" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_recipient_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "sms_group_recipients" ADD CONSTRAINT "sms_group_recipients_group_id_sms_recipient_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."sms_recipient_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_group_recipient_phone" ON "sms_group_recipients" USING btree ("group_id","phone");