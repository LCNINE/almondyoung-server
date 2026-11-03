-- 계정의 테넌트 채우기 (ADR-0056 expand). 다시 돌려도 같은 결과가 나온다(멱등) — 비어 있는 칸만 채우고, 어긋난 부여만 지운다.
-- 테넌트 1 의 id 는 테넌트 목록(TENANT_LIST)·토큰 tenant 와 같은 문자열 '1' 이다.
--
-- 🔴 라이브에서는 이 마이그 «전에» 읽기 전용 명령으로 아래 «어긋난 계정» 수와 명단을 본다(0 이 아니면 사람이 확인):
--    npm run tenancy:account-tenant-preview -- --stage live
-- 그 명령의 분류는 scripts/tenancy/account-tenant-preview/preview-query.ts 이고, 아래 두 UPDATE 와 같은 규칙이다
-- (통합 스펙 account-tenant-backfill.integration.spec.ts 가 둘이 같은 계정을 고르는지 본다).
--
-- 계정이 «이어진» 테넌트 = 그 테넌트의 부여(고객 역할·기간 끝난 부여 포함, 테넌트가 빈 부여는 테넌트 1) · 테넌트 1 이 아닌 테넌트의 소속 ·
-- 그리고 테넌트 1 쇼핑몰 흔적(가입 동의·소셜 신원 — 둘 다 테넌트 1 쇼핑몰에서만 생긴다)이나 플랫폼 운영자 성질이면 테넌트 1.
-- 고객 흔적 하나만으로도 테넌트 1 에 남긴다 — 다른 테넌트로 옮기면 그 사람의 쇼핑몰 계정(주문·적립금이 계정 id 에 걸려 있다)이 사라진다.
-- 테넌트 1 «소속»은 이음으로 치지 않는다: 테넌트 1 백필 마이그(20261030055256)를 시드가 다시 돌리면 다른 테넌트의 직원 부여를 보고도
-- 테넌트 1 소속을 만들어, 테넌트 2 에만 속한 직원에게 가짜 테넌트 1 소속이 붙어 있다. 테넌트 1 직원은 테넌트 1 부여로 이어진다.

-- 1. 이어진 테넌트가 테넌트 1 이 아닌 하나뿐인 계정 → 그 테넌트.
UPDATE "users" u
SET "tenant_id" = only_tenant."tenant_id"
FROM (
  SELECT ties."user_id", min(ties."tenant_id") AS "tenant_id"
  FROM (
    SELECT "user_id", coalesce("tenant_id", '1') AS "tenant_id" FROM "user_roles"
    UNION
    SELECT "user_id", "tenant_id" FROM "tenant_memberships" WHERE "tenant_id" <> '1'
    UNION
    SELECT "user_id", '1' FROM "user_consents"
    UNION
    SELECT "user_id", '1' FROM "user_identities"
    UNION
    SELECT "id", '1' FROM "users" WHERE "is_platform_operator"
  ) ties
  GROUP BY ties."user_id"
  HAVING count(DISTINCT ties."tenant_id") = 1 AND min(ties."tenant_id") <> '1'
) only_tenant
WHERE u."id" = only_tenant."user_id"
  AND u."tenant_id" IS NULL;--> statement-breakpoint

-- 2. 나머지 전부(고객, 테넌트 1 직원, 아무 테넌트와도 이어지지 않은 계정, 두 테넌트 이상과 이어진 계정) → 테넌트 1. 계정 id 는 그대로다.
UPDATE "users" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint

-- 3. 계정의 테넌트가 아닌 테넌트의 부여를 거둔다(두 테넌트와 이어졌던 계정의 다른 테넌트 쪽). 거둔 것은 변경 이력에 남긴다 —
--    요청자가 없는 일이라 actor 는 nil uuid·'migration' 이다. 그 사람의 그 테넌트 계정은 그 테넌트의 master 가 새로 만든다.
WITH revoked AS (
  DELETE FROM "user_roles" ur
  USING "users" u
  WHERE ur."user_id" = u."id"
    AND coalesce(ur."tenant_id", '1') <> u."tenant_id"
  RETURNING ur."user_id", coalesce(ur."tenant_id", '1') AS "tenant_id", ur."role_id", ur."expires_at"
)
INSERT INTO "iam_audit_logs" ("actor_user_id", "actor_login_id", "action", "target_type", "target_id", "target_label", "before", "after", "tenant_id")
SELECT
  '00000000-0000-0000-0000-000000000000',
  'migration',
  'user.roles.replace',
  'user',
  revoked."user_id"::text,
  left(u."login_id", 100),
  jsonb_agg(jsonb_build_object('roleId', revoked."role_id", 'name', r."name", 'expiresAt', revoked."expires_at") ORDER BY r."name"),
  '[]'::jsonb,
  revoked."tenant_id"
FROM revoked
JOIN "users" u ON u."id" = revoked."user_id"
JOIN "roles" r ON r."role_id" = revoked."role_id"
GROUP BY revoked."user_id", revoked."tenant_id", u."login_id";--> statement-breakpoint

-- 4. 같은 이유로 계정의 테넌트가 아닌 소속도 거둔다(위의 가짜 테넌트 1 소속 포함) — 남겨 두면 그 테넌트에서 이 계정에 직원 역할을 다시 줄 수 있다.
DELETE FROM "tenant_memberships" m
USING "users" u
WHERE m."user_id" = u."id" AND m."tenant_id" <> u."tenant_id";--> statement-breakpoint

-- 5. 진행 중이던 인증번호는 모두 테넌트 1 쇼핑몰의 것이다.
UPDATE "phone_verifications" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint
UPDATE "email_verifications" SET "tenant_id" = '1' WHERE "tenant_id" IS NULL;--> statement-breakpoint

-- 다리(expand 기간 한정): 롤링 배포 중 옛 태스크의 쓰기(가입·인증번호)를 테넌트 1 로 채운다. 새 코드는 언제나 테넌트를 넘긴다.
-- schema.ts 에는 적지 않는다 — 테넌트 id 를 코드 상수로 두지 않기 위해서다. NOT NULL 로 조이는 contract 마이그가 이 기본값을 걷어낸다.
-- 옛 태스크로 다른 테넌트의 직원을 만들면 테넌트 1 계정이 된다 — 배포 중에는 테넌트 만들기 스크립트를 돌리지 않는다.
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "phone_verifications" ALTER COLUMN "tenant_id" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "email_verifications" ALTER COLUMN "tenant_id" SET DEFAULT '1';
