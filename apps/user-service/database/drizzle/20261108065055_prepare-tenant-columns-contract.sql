-- 부여·접속기록의 테넌트와 테넌트 도메인의 앱 — contract 준비. 바로 뒤 마이그(…_contract-tenant-columns-not-null)가 NOT NULL 을 건다.
-- 배포 순서는 deploy → migrate 다(새 코드가 접속기록에 테넌트를 적은 «뒤»에 돈다).

-- 1. 접속기록의 테넌트를 바로잡는다. 이 칸을 적는 코드가 없어 지금까지의 행은 전부 DB 기본값 '1' 을 받았다 — 테넌트 2 직원의 열람도.
--    열람한 직원 계정의 테넌트로 고친다: 계정은 한 테넌트의 것이고 토큰은 그 테넌트로만 나간다(ADR-0056). 계정이 지워진 행은 그대로 둔다.
--    접속기록의 다른 칸은 건드리지 않는다.
UPDATE "pii_access_logs" p
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE p."actor_user_id" = u."id"
  AND p."tenant_id" = '1'
  AND u."tenant_id" <> '1';--> statement-breakpoint

-- 2. 빈 칸이 남았으면 멈춘다 — 기본 테넌트는 없으니 채울 값을 마이그가 지어내지 않는다. 기본값이 받아 왔으므로 0 이어야 한다.
--    멈추면 이 마이그 전체가 되돌려진다(새 코드는 nullable 스키마에서도 돈다). 아래로 명단을 보고 사람이 정한 뒤 다시 돌린다:
--      SELECT 'user_roles' AS t, count(*) FROM user_roles WHERE tenant_id IS NULL
--      UNION ALL SELECT 'pii_access_logs', count(*) FROM pii_access_logs WHERE tenant_id IS NULL
--      UNION ALL SELECT 'tenant_domains.app', count(*) FROM tenant_domains WHERE app IS NULL;
DO $$
DECLARE
  grants integer;
  accesses integer;
  domains integer;
BEGIN
  SELECT count(*) INTO grants FROM "user_roles" WHERE "tenant_id" IS NULL;
  SELECT count(*) INTO accesses FROM "pii_access_logs" WHERE "tenant_id" IS NULL;
  SELECT count(*) INTO domains FROM "tenant_domains" WHERE "app" IS NULL;
  IF grants + accesses + domains > 0 THEN
    RAISE EXCEPTION 'tenant column contract: user_roles %, pii_access_logs % row(s) without a tenant, tenant_domains % row(s) without an app',
      grants, accesses, domains;
  END IF;
END $$;--> statement-breakpoint

-- 3. 부여·이력·접속기록 테넌트의 DB 기본값('1')을 걷는다 — 기본 테넌트는 없다. schema.ts 엔 원래 없던 값이라 drizzle 이 모른다.
--    이력(iam_audit_logs)은 nullable 로 남는다: 운영자 성질 변경처럼 테넌트 밖의 일은 일부러 null 로 적는다. 쓰는 곳은 언제나 값을 명시한다.
ALTER TABLE "user_roles" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "iam_audit_logs" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pii_access_logs" ALTER COLUMN "tenant_id" DROP DEFAULT;
