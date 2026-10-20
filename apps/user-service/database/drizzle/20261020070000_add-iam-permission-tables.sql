CREATE TABLE "iam_permissions" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"domain" varchar(50) NOT NULL,
	"label" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"dangerous" boolean NOT NULL,
	"system_only" boolean NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"deprecated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "iam_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(100) NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iam_role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "display_name" varchar(100);--> statement-breakpoint
ALTER TABLE "iam_role_permissions" ADD CONSTRAINT "iam_role_permissions_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_role_permissions" ADD CONSTRAINT "iam_role_permissions_permission_key_iam_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."iam_permissions"("key") ON DELETE no action ON UPDATE no action;