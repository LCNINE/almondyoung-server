CREATE TABLE "external_revenue_monthly" (
	"channel" varchar(20) NOT NULL,
	"account" varchar(100) NOT NULL,
	"month" varchar(7) NOT NULL,
	"basis" varchar(30) NOT NULL,
	"amount" bigint NOT NULL,
	"source" varchar(255) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_revenue_monthly_channel_account_month_basis_pk" PRIMARY KEY("channel","account","month","basis")
);
