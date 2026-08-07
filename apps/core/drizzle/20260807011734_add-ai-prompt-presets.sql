CREATE TABLE "ai_prompt_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"content" text NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	"owner_name" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_prompt_presets_scope" ON "ai_prompt_presets" USING btree ("scope","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_prompt_presets_scope_title" ON "ai_prompt_presets" USING btree ("scope","title");