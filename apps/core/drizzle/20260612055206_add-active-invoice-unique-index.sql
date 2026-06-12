-- FO 당 활성(미취소) invoice 1개 보장 — 동시 발행 race 의 DB 레벨 방어선.
--
-- ⚠️ 적용 전 preflight (기존 데이터가 규칙을 어기면 인덱스 생성이 실패한다):
--   SELECT fulfillment_order_id, count(*) FROM invoices
--   WHERE status <> 'canceled' GROUP BY 1 HAVING count(*) > 1;
-- 결과가 있으면 중복 invoice 중 남길 1건 외에는 status='canceled' 로 정리 후 적용.
-- (dev: 2026-06-12 invoices 0건 확인 후 적용 완료. live: 적용 전 위 쿼리 필수)
CREATE UNIQUE INDEX "uq_invoices_fo_active" ON "invoices" USING btree ("fulfillment_order_id") WHERE "invoices"."status" <> 'canceled';
