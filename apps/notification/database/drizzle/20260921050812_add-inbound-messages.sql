CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_message_id" varchar(128),
	"phone_number" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"device_id" varchar(64),
	"user_id" varchar(100),
	"received_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_messages_gateway_message_id_unique" UNIQUE("gateway_message_id")
);
--> statement-breakpoint
CREATE INDEX "idx_inbound_phone_received" ON "inbound_messages" USING btree ("phone_number","received_at");