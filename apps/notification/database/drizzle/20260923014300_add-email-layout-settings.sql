CREATE TABLE "email_layout_settings" (
	"id" varchar(20) PRIMARY KEY NOT NULL,
	"logo_url" text,
	"brand_color" varchar(20) NOT NULL,
	"text_color" varchar(20) NOT NULL,
	"background_color" varchar(20) NOT NULL,
	"footer_contact" text NOT NULL,
	"footer_business" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
