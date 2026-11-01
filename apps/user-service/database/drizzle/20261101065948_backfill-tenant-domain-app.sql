-- 이미 있는 테넌트 도메인의 앱을 채운다(멱등 — app 이 빈 행만).
-- admin-web OAuth 클라이언트의 리디렉트 주소 host 인 도메인 = admin-web 주소. 테넌트 1 의 도메인은 모두 그 주소에서 왔다
-- (20261030055256_backfill-tenant-one-memberships-operators), 테넌트 도메인의 admin-web 주소도 만들기 스크립트가 거기 등록한다.
UPDATE "tenant_domains" SET "app" = 'admin-web'
WHERE "app" IS NULL
  AND "host" IN (
    SELECT DISTINCT lower(substring(uri FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)'))
    FROM "oauth_clients", jsonb_array_elements_text("oauth_clients"."redirect_uris") AS uri
    WHERE "oauth_clients"."client_id" = 'admin-web'
  );--> statement-breakpoint

-- 나머지는 auth-web 주소다 — 지금까지 리디렉트 주소가 아닌 테넌트 도메인을 붙인 길은 테넌트의 auth-web 주소뿐이었다.
UPDATE "tenant_domains" SET "app" = 'auth-web' WHERE "app" IS NULL;
