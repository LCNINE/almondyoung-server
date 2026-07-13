#!/usr/bin/env bash
# 로컬 compose core DB 대상 통합 테스트 러너 (dev 스테이지 폐기 대체).
# rollback-only spec 은 DB 를 더럽히지 않는다. Kafka 불필요(outbox mock).
#
# 사용법: npm run test:core:integration:local            # 전체 integration
#         npm run test:core:integration:local -- receive.integration   # 패턴 지정
# LOCAL_PG 로 접속 URL 오버라이드 가능(포트 충돌 시).
set -euo pipefail
cd "$(dirname "$0")/../.."

PG="${LOCAL_PG:-postgresql://postgres:postgres@localhost:5432}"
CORE_URL="${PG}/core"
PATTERN="${1:-integration}"

echo "── 1/3 compose postgres 기동"
docker compose up -d postgres

echo "── 2/3 postgres 준비 대기"
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  [ "$i" -eq 30 ] && { echo "postgres 준비 타임아웃" >&2; exit 1; }
  sleep 1
done

echo "── 3/3 core 마이그레이션(이미 적용됐으면 no-op)"
DATABASE_URL="$CORE_URL" npx drizzle-kit migrate --config apps/core/drizzle.config.ts

echo "── jest 실행 (pattern=${PATTERN})"
DATABASE_URL="$CORE_URL" npx jest --testPathPattern="$PATTERN" --runInBand
