-- 격리 사유를 라인 단위로 담는다 (#674).
--
-- nullable 인 이유: 옛 행과 `collected_order_modification_not_accepted` 행은 사유를 모른다.
-- 백필하지 않는다 — 사후에 사유를 만들어내는 것보다 "판정 불가" 가 정직하다.
--
-- additive 이므로 **`migrate` 가 `deploy` 앞이다** (ADR-0005 §5 expand phase). 새 컬럼을
-- 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다.
ALTER TABLE "order_collection_failures" ADD COLUMN "affected_lines" jsonb;