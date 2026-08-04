#!/usr/bin/env bash
# 멤버십 해지·환불 E2E — 로컬 postgres(docker compose)의 테스트 전용 논리 DB 에서 실행한다.
#
#   npm run test:membership:cancellation-e2e
#
# 왜 별도 논리 DB(membership_e2e)인가: 이 스펙은 테이블을 전부 비운다. 개발용 `membership` DB 를
# 그대로 쓰면 로컬에 만들어 둔 구독 데이터가 날아가므로, 같은 postgres 안에 테스트 전용 DB 를 만들어
# 쓴다(스키마는 라이브와 동일하게 drizzle 마이그레이션을 전량 적용).
#
# 원격 DB 는 절대 건드리지 않는다 — DATABASE_URL 을 셸에서 명시 주입하므로 각 앱 .env 가 어디를
# 가리키든(공유 Neon 등) 영향받지 않는다. migrate-all.sh 와 같은 방식이다.
#
# LOCAL_PG 로 접속 대상 변경 가능 (기본 postgresql://postgres:postgres@localhost:5432).
set -euo pipefail
cd "$(dirname "$0")/../.."

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
TEST_DB="${MEMBERSHIP_E2E_DB:-membership_e2e}"
DB_URL="${PG}/${TEST_DB}"

# postgres 가 안 떠 있으면 원인을 분명히 알려주고 끝낸다(빈 DB 로 조용히 실패하는 것보다 낫다).
if ! docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "✗ 로컬 postgres 가 실행 중이 아니다. 먼저 인프라를 띄운다:" >&2
  echo "    docker compose up -d postgres" >&2
  exit 1
fi

echo "▶ 테스트 전용 DB 준비 (${TEST_DB})"
docker compose exec -T postgres psql -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" | grep -q 1 ||
  docker compose exec -T postgres createdb -U postgres "${TEST_DB}"

echo "▶ 마이그레이션 적용 (drizzle)"
DATABASE_URL="$DB_URL" npx drizzle-kit migrate --config apps/membership/drizzle.config.ts

echo "▶ E2E 실행"
MEMBERSHIP_CANCELLATION_E2E=1 DATABASE_URL="$DB_URL" npx jest --testPathPattern="cancellation-e2e|cancellation-http-e2e" --runInBand "$@"
