CREATE TABLE "bank_account_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"method_type" text DEFAULT 'BANK_ACCOUNT' NOT NULL,
	"pg_token" varchar(128) NOT NULL,
	"billing_key" varchar(128) NOT NULL,
	"masked_account_number" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bnpl_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"method_type" text DEFAULT 'BNPL' NOT NULL,
	"credit_limit" numeric(18, 2),
	"approved_limit" numeric(18, 2),
	"terms_url" varchar(256),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"method_type" text DEFAULT 'CARD' NOT NULL,
	"pg_token" varchar(128) NOT NULL,
	"billing_key" varchar(128) NOT NULL,
	"masked_card_number" varchar(32) NOT NULL,
	"last_four_digits" varchar(4),
	"card_brand" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_institution" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"roles" text[] NOT NULL,
	"settlement_currency" varchar(3),
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_institution_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"method_type" text NOT NULL,
	"method_name" varchar(64) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"institution_id" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_payment_method_id_type" UNIQUE("id","method_type")
);
--> statement-breakpoint
CREATE TABLE "prepaid_wallet_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"method_type" text DEFAULT 'PREPAID_WALLET' NOT NULL,
	"wallet_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_point_method" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"method_type" text DEFAULT 'REWARD_POINT' NOT NULL,
	"balance_snapshot" numeric(18, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"wallet_id" varchar(26) NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"event_source_id" varchar(26) NOT NULL,
	"event_source_name" varchar(32) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"wallet_name" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	"status" text NOT NULL,
	"last_transaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_account_method" ADD CONSTRAINT "fk_bank_account_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bnpl_method" ADD CONSTRAINT "fk_bnpl_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_method" ADD CONSTRAINT "fk_card_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_institution_id_payment_institution_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."payment_institution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_wallet_method" ADD CONSTRAINT "prepaid_wallet_method_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaid_wallet_method" ADD CONSTRAINT "fk_prepaid_wallet_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_point_method" ADD CONSTRAINT "fk_reward_point_method_payment_method" FOREIGN KEY ("id","method_type") REFERENCES "public"."payment_method"("id","method_type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_events" ADD CONSTRAINT "wallet_events_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bank_billing_key_unique" ON "bank_account_method" USING btree ("billing_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_card_billing_key_unique" ON "card_method" USING btree ("billing_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_default_unique" ON "payment_method" USING btree ("user_id") WHERE "payment_method"."is_default" = true;