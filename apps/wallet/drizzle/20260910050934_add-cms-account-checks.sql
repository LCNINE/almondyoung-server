CREATE TABLE "cms_account_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"payment_company" varchar(3) NOT NULL,
	"masked_payment_number" varchar(32),
	"verified" boolean NOT NULL,
	"result_code" varchar(16),
	"result_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_cms_account_checks_user_created" ON "cms_account_checks" USING btree ("user_id","created_at");