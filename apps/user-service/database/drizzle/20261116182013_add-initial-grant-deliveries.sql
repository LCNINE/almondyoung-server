CREATE TABLE "iam_initial_grant_deliveries" (
	"permission_key" varchar(100) NOT NULL,
	"role_id" uuid NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iam_initial_grant_deliveries_permission_key_role_id_pk" PRIMARY KEY("permission_key","role_id")
);
--> statement-breakpoint
ALTER TABLE "iam_initial_grant_deliveries" ADD CONSTRAINT "iam_initial_grant_deliveries_permission_key_iam_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."iam_permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_initial_grant_deliveries" ADD CONSTRAINT "iam_initial_grant_deliveries_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE cascade ON UPDATE no action;