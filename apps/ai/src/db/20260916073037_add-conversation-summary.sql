ALTER TABLE "assistant_chat_sessions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "assistant_chat_sessions" ADD COLUMN "summarized_through" timestamp with time zone;