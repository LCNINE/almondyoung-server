CREATE TABLE "product_ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_ai_messages_sequence_positive" CHECK ("product_ai_messages"."sequence" > 0),
	CONSTRAINT "product_ai_messages_role_valid" CHECK ("product_ai_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "product_ai_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_ai_sessions_revision_nonnegative" CHECK ("product_ai_sessions"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_ai_messages" ADD CONSTRAINT "product_ai_messages_session_id_product_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."product_ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_ai_messages_session_request_unique" ON "product_ai_messages" USING btree ("session_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_ai_messages_session_sequence_unique" ON "product_ai_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "product_ai_sessions_owner_request_unique" ON "product_ai_sessions" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "product_ai_sessions_owner_updated_idx" ON "product_ai_sessions" USING btree ("owner_id","updated_at","id");