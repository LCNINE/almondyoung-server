CREATE TABLE "abandoned_operation_keys" (
	"operation_key" varchar(255) PRIMARY KEY NOT NULL,
	"abandoned_by" varchar(255) NOT NULL,
	"abandoned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_report_marks" (
	"device_id" uuid NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"report_seq" bigint NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_report_marks_device_id_actor_id_pk" PRIMARY KEY("device_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "device_unresolved_operations" (
	"operation_key" varchar(255) PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"device_kind" varchar(16) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"worker_name" varchar(100),
	"method" varchar(10) NOT NULL,
	"path" varchar(500) NOT NULL,
	"work_name" varchar(50) NOT NULL,
	"summary" varchar(300),
	"device_status" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(128),
	"recorded_at" timestamp with time zone NOT NULL,
	"first_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" varchar(16),
	"resolved_by" varchar(255),
	CONSTRAINT "ck_device_unresolved_resolution" CHECK (("device_unresolved_operations"."resolved_at" IS NULL) = ("device_unresolved_operations"."resolution" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "idx_device_unresolved_device" ON "device_unresolved_operations" USING btree ("device_id","actor_id");--> statement-breakpoint
CREATE INDEX "idx_device_unresolved_open" ON "device_unresolved_operations" USING btree ("last_reported_at") WHERE "device_unresolved_operations"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_fulfillment_command_key" ON "fulfillment_command_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_inv_idem_requests_key" ON "inventory_idempotency_requests" USING btree ("key");