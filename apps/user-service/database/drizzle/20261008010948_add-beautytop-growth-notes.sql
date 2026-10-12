CREATE TABLE "beautytop_growth_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_kind" varchar(16) NOT NULL,
	"shop_id" integer NOT NULL,
	"action" varchar(32) NOT NULL,
	"memo" varchar(240) DEFAULT '' NOT NULL,
	"recorded_on" date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_beautytop_growth_daily_action" UNIQUE("user_id","shop_kind","shop_id","recorded_on","action"),
	CONSTRAINT "ck_beautytop_growth_action" CHECK ("beautytop_growth_notes"."action" IN ('MENU_CLARITY', 'SHOWCASE', 'PRICE_CHANGE')),
	CONSTRAINT "ck_beautytop_growth_kind" CHECK ("beautytop_growth_notes"."shop_kind" IN ('SHOP', 'PERSON'))
);
--> statement-breakpoint
ALTER TABLE "beautytop_growth_notes" ADD CONSTRAINT "beautytop_growth_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_beautytop_growth_user_shop_created" ON "beautytop_growth_notes" USING btree ("user_id","shop_kind","shop_id","created_at");