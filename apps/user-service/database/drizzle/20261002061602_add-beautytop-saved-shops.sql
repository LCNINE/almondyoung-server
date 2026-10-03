CREATE TABLE "beautytop_saved_shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"shop_kind" varchar(16) NOT NULL,
	"shop_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"sido" varchar(40),
	"gugun" varchar(40),
	"category" varchar(40),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_beautytop_saved_user_role_shop" UNIQUE("user_id","role","shop_kind","shop_id")
);
--> statement-breakpoint
ALTER TABLE "beautytop_saved_shops" ADD CONSTRAINT "beautytop_saved_shops_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_beautytop_saved_one_my_shop" ON "beautytop_saved_shops" USING btree ("user_id") WHERE "beautytop_saved_shops"."role" = 'MY_SHOP';