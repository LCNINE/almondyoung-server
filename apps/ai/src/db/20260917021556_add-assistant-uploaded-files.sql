CREATE TABLE "assistant_uploaded_files" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"context_id" varchar(50) NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_assistant_uploaded_files_uploaded_at" ON "assistant_uploaded_files" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "idx_assistant_uploaded_files_released_at" ON "assistant_uploaded_files" USING btree ("released_at");