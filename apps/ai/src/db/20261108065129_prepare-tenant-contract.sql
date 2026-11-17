-- 대화·업로드 추적의 테넌트 — contract 준비. 바로 뒤 마이그(…_contract-tenant-not-null)가 NOT NULL 을 건다.
-- 배포 순서는 deploy → migrate 다(새 코드가 테넌트를 모르는 요청을 거절하고 모든 쓰기에 테넌트를 적은 «뒤»에 돈다).

-- 1. 빈 칸이 남았으면 멈춘다 — 기본 테넌트는 없으니 채울 값을 마이그가 지어내지 않는다. 기본값이 받아 왔으므로 0 이어야 한다.
--    멈추면 이 마이그 전체가 되돌려진다. 명단:
--      SELECT 'sessions' AS t, count(*) FROM assistant_chat_sessions WHERE tenant_id IS NULL
--      UNION ALL SELECT 'uploaded_files', count(*) FROM assistant_uploaded_files WHERE tenant_id IS NULL;
DO $$
DECLARE
  sessions integer;
  files integer;
BEGIN
  SELECT count(*) INTO sessions FROM "assistant_chat_sessions" WHERE "tenant_id" IS NULL;
  SELECT count(*) INTO files FROM "assistant_uploaded_files" WHERE "tenant_id" IS NULL;
  IF sessions + files > 0 THEN
    RAISE EXCEPTION 'ai tenant contract: % session(s), % uploaded file(s) have no tenant', sessions, files;
  END IF;
END $$;--> statement-breakpoint

-- 2. DB 기본값('1', …_backfill-tenant-one)을 걷는다 — 기본 테넌트는 없다. schema.ts 엔 원래 없던 값이라 drizzle 이 모른다.
ALTER TABLE "assistant_chat_sessions" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "assistant_uploaded_files" ALTER COLUMN "tenant_id" DROP DEFAULT;
