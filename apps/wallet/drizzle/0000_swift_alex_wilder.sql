CREATE TABLE "bank" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_account_method" (
	"id" bigint PRIMARY KEY NOT NULL,
	"bank_id" bigint NOT NULL,
	"pg_token" varchar(128) NOT NULL,
	"billing_key" varchar(128) NOT NULL,
	"masked_account_number" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_company" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_method" (
	"id" bigint PRIMARY KEY NOT NULL,
	"card_company_id" bigint NOT NULL,
	"pg_token" varchar(128) NOT NULL,
	"billing_key" varchar(128) NOT NULL,
	"masked_card_number" varchar(64) NOT NULL,
	"expiry_month_year" varchar(6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"method_type" varchar(32) NOT NULL,
	"method_name" varchar(64) NOT NULL,
	"is_default" varchar(1) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaid_wallet_method" (
	"id" bigint PRIMARY KEY NOT NULL,
	"wallet_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_point_method" (
	"id" bigint PRIMARY KEY NOT NULL,
	"point_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
