-- 파일의 테넌트 — contract 준비. 바로 뒤 마이그(…_contract-upload-tenant-not-null)가 NOT NULL 을 건다.
-- 배포 순서는 deploy → migrate 다(새 코드가 테넌트를 모르는 요청을 거절하고 모든 업로드에 테넌트를 적은 «뒤»에 돈다).

-- 1. 빈 칸이 남았으면 멈춘다 — 기본 테넌트는 없으니 채울 값을 마이그가 지어내지 않는다. 기본값이 받아 왔으므로 0 이어야 한다.
--    멈추면 이 마이그 전체가 되돌려진다. 명단: SELECT id, uploaded_by, created_at FROM uploads WHERE tenant_id IS NULL;
DO $$
DECLARE
  loose integer;
BEGIN
  SELECT count(*) INTO loose FROM "uploads" WHERE "tenant_id" IS NULL;
  IF loose > 0 THEN
    RAISE EXCEPTION 'upload tenant contract: % upload(s) have no tenant', loose;
  END IF;
END $$;--> statement-breakpoint

-- 2. DB 기본값('1', …_backfill-upload-tenant-one)을 걷는다 — 기본 테넌트는 없다. schema.ts 엔 원래 없던 값이라 drizzle 이 모른다.
ALTER TABLE "uploads" ALTER COLUMN "tenant_id" DROP DEFAULT;
