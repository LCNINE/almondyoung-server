ALTER TABLE "assistant_chat_sessions" ADD COLUMN "tenant_id" varchar(64);--> statement-breakpoint
ALTER TABLE "assistant_uploaded_files" ADD COLUMN "tenant_id" varchar(64);