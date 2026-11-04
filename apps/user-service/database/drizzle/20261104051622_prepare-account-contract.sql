-- 계정은 한 테넌트의 것 — contract 준비 (ADR-0056). 바로 뒤 마이그(…_contract-account-unique-within-tenant)가 NOT NULL·테넌트 안 unique 를
-- 걸고 소속 표를 지운다. 배포 순서는 deploy → migrate 다(새 코드가 소속을 안 쓰고 모든 계정 쓰기에 테넌트를 적은 «뒤»에 돈다).

-- 1. 소셜 신원·사업자 등록의 테넌트를 한 번 더 채운다 — expand 마이그(…_backfill-identity-license-tenant)와 그 배포 사이에 옛 코드가 넣은 행.
UPDATE "user_identities" i
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE i."user_id" = u."id"
  AND i."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "business_licenses" b
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE b."user_id" = u."id"
  AND b."tenant_id" IS NULL;--> statement-breakpoint

-- 2. 계정의 테넌트가 비었거나, 계정의 테넌트가 아닌 테넌트의 부여가 남아 있으면 멈춘다. 계정은 한 테넌트의 것이라 그런 부여는
--    «남의 테넌트에서 일하는 계정»이다(기간이 끝난 부여·탈퇴 계정의 부여도 센다 — 채우기 마이그가 그것들까지 거뒀다). 테넌트가 빈 부여도 센다:
--    기본 테넌트는 없다. 채우기와 iam Manager 가 막으므로 0 이어야 한다. 멈추면 이 마이그 전체가 되돌려지고(새 코드는 옛 스키마에서도 돈다)
--    아래 질의로 명단을 본 뒤 그 테넌트의 관리자가 회수하고 다시 돌린다:
--      SELECT ur.user_id, u.tenant_id AS account_tenant, ur.tenant_id AS grant_tenant, r.name, ur.expires_at
--      FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.role_id = ur.role_id
--      WHERE ur.tenant_id IS DISTINCT FROM u.tenant_id;
DO $$
DECLARE
  loose integer;
  stray integer;
BEGIN
  SELECT count(*) INTO loose FROM "users" WHERE "tenant_id" IS NULL;
  IF loose > 0 THEN
    RAISE EXCEPTION 'account contract: % account(s) have no tenant — run the account tenant backfill first', loose;
  END IF;
  SELECT count(*) INTO stray
  FROM "user_roles" ur
  JOIN "users" u ON u."id" = ur."user_id"
  WHERE ur."tenant_id" IS DISTINCT FROM u."tenant_id";
  IF stray > 0 THEN
    RAISE EXCEPTION 'account contract: % grant(s) sit in a tenant other than the account''s tenant — revoke them first', stray;
  END IF;
END $$;--> statement-breakpoint

-- 3. 계정 테넌트·인증 기록 테넌트의 DB 기본값('1')을 걷는다(함정 27) — 기본 테넌트는 없다. schema.ts 엔 원래 없던 값이라 drizzle 이 모른다.
--    부여·이력·접속기록(user_roles·iam_audit_logs·pii_access_logs)의 기본값은 이 contract 의 몫이 아니다(다른 서비스가 테넌트 없이 보내는 접속기록이 있다).
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "phone_verifications" ALTER COLUMN "tenant_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "email_verifications" ALTER COLUMN "tenant_id" DROP DEFAULT;
