#!/usr/bin/env bash
# 멤버십 해지·환불 E2E — 전용 임시 Postgres 에서 실행한다.
#
# 공유 dev(Neon)/live DB 를 쓰지 않는 이유: 스펙이 테이블을 전부 비우기 때문이다.
# 컨테이너를 띄워 라이브와 동일한 마이그레이션(8건)을 처음부터 적용한 뒤 테스트를 돌린다.
#
#   npm run test:membership:cancellation-e2e
#
# KEEP_DB=1 을 주면 검사용으로 컨테이너를 남긴다 (psql -h 127.0.0.1 -p 15433 -U e2e membership).
set -euo pipefail

CONTAINER=ay-membership-e2e
PORT=15433
DB_URL="postgres://e2e:e2e@127.0.0.1:${PORT}/membership"

cleanup() {
  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  else
    echo "KEEP_DB=1 — 컨테이너 유지: $DB_URL"
  fi
}
trap cleanup EXIT

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "▶ 임시 Postgres 기동 ($CONTAINER:$PORT)"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=e2e -e POSTGRES_USER=e2e -e POSTGRES_DB=membership \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U e2e -d membership >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "▶ 마이그레이션 적용 (drizzle)"
DATABASE_URL="$DB_URL" npx drizzle-kit migrate --config apps/membership/drizzle.config.ts

echo "▶ E2E 실행"
MEMBERSHIP_CANCELLATION_E2E=1 DATABASE_URL="$DB_URL" npx jest --testPathPattern=cancellation-e2e --runInBand "$@"
