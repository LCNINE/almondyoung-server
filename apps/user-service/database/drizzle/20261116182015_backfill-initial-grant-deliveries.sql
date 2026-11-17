-- 이미 준 카탈로그 첫 부여 몫을 기록한다(#1248). 셋 중 하나면 «준 것» — 동기화가 되살리지 않는다.
--   ① 지금 부여돼 있다
--   ② 키가 등록될 때 역할이 이미 있었다 — 그때 동기화가 줬고 그 뒤 회수된 것이다
--   ③ 이력에 그 역할에서 그 키를 회수한 기록이 있다 — 늦게 생긴 역할에 사람이 손으로 주고 뺀 것이다
-- 나머지(역할이 키보다 늦게 생겼고 부여도 회수 이력도 없음)가 다음 부팅에 부여되는 몫이다.
-- 카탈로그는 코드라 SQL 이 모른다: 모든 (권한, 역할) 쌍을 보고, 첫 부여 대상이 아닌 쌍이 기록돼도 동기화는 카탈로그 몫만 본다.
INSERT INTO "iam_initial_grant_deliveries" ("permission_key", "role_id")
SELECT p."key", r."role_id"
  FROM "iam_permissions" p CROSS JOIN "roles" r
 WHERE EXISTS (
         SELECT 1 FROM "iam_role_permissions" g
          WHERE g."permission_key" = p."key" AND g."role_id" = r."role_id"
       )
    OR r."created_at" <= p."registered_at"
    OR EXISTS (
         SELECT 1 FROM "iam_audit_logs" a
          WHERE a."action" = 'role.permissions.replace'
            AND a."target_type" = 'role'
            AND a."target_id" = r."role_id"::text
            AND a."after" -> 'removed' ? p."key"
       )
ON CONFLICT DO NOTHING;
