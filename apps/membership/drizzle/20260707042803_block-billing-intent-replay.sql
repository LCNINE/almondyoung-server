-- 선검증: 기존 replay 흔적(같은 intent+event_type 이 여러 행)이 있으면 인덱스 생성이 불가하므로
-- 불투명한 CREATE INDEX 실패 대신 정리 방법을 담은 메시지로 fail-fast 한다.
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT payment_intent_id, event_type
    FROM billing_events
    WHERE payment_intent_id IS NOT NULL
    GROUP BY payment_intent_id, event_type
    HAVING count(*) > 1
  ) d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'billing_events 에 (payment_intent_id, event_type) 중복 % 조합 존재 — replay 흔적을 먼저 정리해야 합니다. 확인: SELECT payment_intent_id, event_type, count(*), array_agg(contract_id) FROM billing_events WHERE payment_intent_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;', dup_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_billing_events_intent_event" ON "billing_events" USING btree ("payment_intent_id","event_type");
