-- 소셜 신원·사업자 등록의 테넌트 채우기 (ADR-0056 expand). 둘 다 그 행이 붙은 계정의 테넌트다. 비어 있는 칸만 채워 다시 돌려도 같다(멱등).
-- DB 기본값은 걸지 않는다 — 새 행은 코드가 계정의 테넌트를 적는다. migrate 와 deploy 사이에 옛 코드가 넣은 행은 비어 있을 수 있어,
-- contract 마이그가 NOT NULL 을 걸기 직전에 같은 채우기를 한 번 더 돌린다.
UPDATE "user_identities" i
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE i."user_id" = u."id"
  AND i."tenant_id" IS NULL;--> statement-breakpoint
UPDATE "business_licenses" b
SET "tenant_id" = u."tenant_id"
FROM "users" u
WHERE b."user_id" = u."id"
  AND b."tenant_id" IS NULL;
