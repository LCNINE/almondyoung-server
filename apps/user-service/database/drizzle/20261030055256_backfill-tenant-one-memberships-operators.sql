-- 테넌트 1(아몬드영) 행과 백필. 다시 돌려도 같은 결과가 나온다(멱등).
-- 테넌트 1 의 id 는 테넌트 목록(TENANT_LIST)·토큰 tenant 와 같은 문자열 '1' 이다.
INSERT INTO "tenants" ("id", "slug", "status", "display_name")
VALUES ('1', 'almondyoung', 'active', '아몬드영')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- 테넌트 도메인 = 지금의 관리자 주소. 스테이지마다 다르므로 이 DB 의 admin-web OAuth 클라이언트에 등록된
-- 리디렉트 주소의 host 를 쓴다. 클라이언트가 아직 없는 새 DB(시드 전)에서는 아무것도 넣지 않는다.
INSERT INTO "tenant_domains" ("host", "tenant_id")
SELECT DISTINCT lower(substring(uri FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)')), '1'
FROM "oauth_clients", jsonb_array_elements_text("oauth_clients"."redirect_uris") AS uri
WHERE "oauth_clients"."client_id" = 'admin-web'
  AND substring(uri FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)') IS NOT NULL
ON CONFLICT ("host") DO NOTHING;--> statement-breakpoint

-- 살아 있는 비고객 부여가 있는 계정 → 테넌트 1 소속. 고객(user·membership 만 가진 계정)과 기간이 끝난 직원은 소속이 없다.
-- 고객 역할 이름은 iam.constants.ts 의 CUSTOMER_ROLE_NAMES 와 같아야 한다(아래 가드도).
INSERT INTO "tenant_memberships" ("user_id", "tenant_id")
SELECT DISTINCT ur."user_id", '1'
FROM "user_roles" ur
JOIN "roles" r ON r."role_id" = ur."role_id"
WHERE r."name" NOT IN ('user', 'membership')
  AND (ur."expires_at" IS NULL OR ur."expires_at" > now())
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 기간 없는 master 보유자 → 플랫폼 운영자 성질. 잠김 방지가 «마지막 운영자»로 옮겨 가는 순간 0명이 되지 않게.
UPDATE "users" SET "is_platform_operator" = true
WHERE "is_platform_operator" = false
  AND "id" IN (
    SELECT ur."user_id"
    FROM "user_roles" ur
    JOIN "roles" r ON r."role_id" = ur."role_id"
    WHERE r."name" = 'master' AND ur."expires_at" IS NULL
  );--> statement-breakpoint

-- 기존 부여·변경 이력·접속기록은 모두 테넌트 1 의 것이다.
UPDATE "user_roles" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "iam_audit_logs" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "pii_access_logs" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint

-- 다리(expand 기간 한정): 테넌트를 아직 넘기지 않는 쓰기(고객 가입의 고객 역할, 다른 서비스가 보낸 접속기록,
-- 롤링 배포 중 옛 태스크)를 테넌트 1 로 채운다. schema.ts 에는 적지 않는다 — 테넌트 id 를 코드 상수로 두지 않기 위해서다.
-- NOT NULL 로 조이는 contract 마이그가 이 기본값을 함께 걷어낸다.
ALTER TABLE "user_roles" ALTER COLUMN "tenant_id" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "iam_audit_logs" ALTER COLUMN "tenant_id" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "pii_access_logs" ALTER COLUMN "tenant_id" SET DEFAULT '1';--> statement-breakpoint

-- 직원이 있는데 로그인할 수 있는 운영자가 0명이면 멈춘다 — 그 상태로는 아무도 플랫폼을 관리하지 못한다.
-- 직원이 없는 새 DB(시드 전·테스트 DB)는 통과한다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "user_roles" ur
    JOIN "roles" r ON r."role_id" = ur."role_id"
    WHERE r."name" NOT IN ('user', 'membership')
      AND (ur."expires_at" IS NULL OR ur."expires_at" > now())
  ) AND NOT EXISTS (
    SELECT 1 FROM "users"
    WHERE "is_platform_operator" AND "deleted_at" IS NULL AND "dormant_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'tenant backfill: staff exist but no platform operator can sign in (need a permanent master holder)';
  END IF;
END $$;
