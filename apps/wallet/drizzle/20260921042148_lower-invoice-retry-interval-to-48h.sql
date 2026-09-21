ALTER TABLE "invoices" ALTER COLUMN "retry_interval_hours" SET DEFAULT 48;
--> statement-breakpoint
-- 이미 발행된 미수 인보이스도 2일 주기로 옮긴다. 대기 중인 재시도는 남은 시간에서 24h 를
-- 당기되 과거로는 내리지 않는다(now 보다 앞서면 executor 가 즉시 집행하게 된다).
UPDATE "invoices" SET "retry_interval_hours" = 48
WHERE "retry_interval_hours" = 72 AND "status" IN ('DRAFT', 'OPEN', 'MANDATE_PENDING', 'PAST_DUE', 'ATTEMPTING');--> statement-breakpoint
UPDATE "invoices"
SET "next_attempt_at" = GREATEST(now(), "next_attempt_at" - interval '24 hours')
WHERE "status" = 'PAST_DUE' AND "next_attempt_at" IS NOT NULL AND "next_attempt_at" > now();
