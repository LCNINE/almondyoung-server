-- P0-3/P2-5 dedup (light/dev data). 운영 실사 데이터가 있으면 phase 분리 (spec §10 #1).
-- keeper = 그룹별 (created_at, id) 최대 1행. 나머지(=중복)는 조정까지 정리 후 삭제해 ADD CONSTRAINT 실패를 막는다.
-- (기존 stocktaking_adjustments 는 정상화 이전 원장 우회로 생성된 ghost 레코드 — 원장 미반영이라 삭제 안전.)
-- 1) 중복(비-keeper) 라인에 매달린 조정 삭제 → FK restrict 회피
DELETE FROM "stocktaking_adjustments" a
USING "stocktaking_lines" dup, "stocktaking_lines" keep
WHERE a.line_id = dup.id
  AND dup.session_id = keep.session_id
  AND dup.sku_id = keep.sku_id
  AND dup.location_id IS NOT DISTINCT FROM keep.location_id
  AND (dup.created_at, dup.id) < (keep.created_at, keep.id);
-- 2) 라인당 중복 조정 정리 (keep newest) → adjustments(line_id) unique 보장
DELETE FROM "stocktaking_adjustments" a
USING "stocktaking_adjustments" b
WHERE a.line_id = b.line_id
  AND (a.created_at, a.id) < (b.created_at, b.id);
-- 3) 중복(비-keeper) 라인 삭제 → 이제 매달린 조정이 없어 FK 안전, lines unique 보장
DELETE FROM "stocktaking_lines" dup
USING "stocktaking_lines" keep
WHERE dup.session_id = keep.session_id
  AND dup.sku_id = keep.sku_id
  AND dup.location_id IS NOT DISTINCT FROM keep.location_id
  AND (dup.created_at, dup.id) < (keep.created_at, keep.id);
--> statement-breakpoint
ALTER TABLE "stocktaking_adjustments" ADD CONSTRAINT "uq_stocktaking_adjustment_line" UNIQUE("line_id");--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD CONSTRAINT "uq_stocktaking_line_session_sku_location" UNIQUE NULLS NOT DISTINCT("session_id","sku_id","location_id");
