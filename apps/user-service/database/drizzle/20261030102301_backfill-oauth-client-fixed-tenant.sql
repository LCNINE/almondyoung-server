-- 오늘의 OAuth 클라이언트는 admin-web 을 빼면 모두 테넌트 1 의 고정 테넌트 앱이다(쇼핑몰·결제창·물류앱·외부 RP).
-- 등록된 리디렉트 주소의 host 가 하나도 테넌트 도메인이 아닌 클라이언트 → 테넌트 1 로 고정한다. 리디렉트 host 가
-- 테넌트 도메인인 클라이언트(admin-web)는 비워 둔다 — 그 host 가 토큰 테넌트를 정한다.
-- 다시 돌려도 같은 결과가 나온다(멱등). 새 DB 는 시드가 클라이언트를 넣은 뒤 이 파일을 다시 돌린다.
UPDATE "oauth_clients" c SET "tenant_id" = '1'
WHERE c."tenant_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(c."redirect_uris") AS uri
    JOIN "tenant_domains" d
      ON d."host" = lower(substring(uri FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)'))
  );
