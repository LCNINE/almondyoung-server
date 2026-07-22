-- 라이브 무중단 적용: db:migrate 전에 CREATE INDEX CONCURRENTLY 로 선생성하면 아래 IF NOT EXISTS 는
-- no-op 이 된다. 절차는 docs/runbooks/order-list-perf-indexes.md 참고.
-- 새/로컬/작은 DB 에서는 이 파일만으로 생성된다(짧은 락 허용).
CREATE INDEX IF NOT EXISTS "idx_sales_order_lines_sales_order_id" ON "sales_order_lines" USING btree ("sales_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sales_orders_order_date" ON "sales_orders" USING btree ("order_date");