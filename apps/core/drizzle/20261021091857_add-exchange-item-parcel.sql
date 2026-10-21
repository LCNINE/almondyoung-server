ALTER TABLE "exchange_request_items" ADD COLUMN "shipment_line_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_request_items" ADD COLUMN "dispatch_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_request_items" ADD CONSTRAINT "exchange_request_items_shipment_line_id_shipment_lines_id_fk" FOREIGN KEY ("shipment_line_id") REFERENCES "public"."shipment_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_request_items" ADD CONSTRAINT "exchange_request_items_dispatch_attempt_id_dispatch_attempts_id_fk" FOREIGN KEY ("dispatch_attempt_id") REFERENCES "public"."dispatch_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exchange_request_items_shipment_line" ON "exchange_request_items" USING btree ("shipment_line_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_request_items_dispatch_attempt" ON "exchange_request_items" USING btree ("dispatch_attempt_id");